import { mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml";
import type { Tour } from "./types.js";

function tourDir(repoRoot: string, id: string): string {
  return join(repoRoot, ".tour", id);
}

function tourPath(repoRoot: string, id: string): string {
  return join(tourDir(repoRoot, id), "tour.toml");
}

export async function createTour(
  repoRoot: string,
  tour: Tour,
): Promise<void> {
  const dir = tourDir(repoRoot, tour.id);
  await mkdir(dir, { recursive: true });
  await writeFile(tourPath(repoRoot, tour.id), stringifyTOML(tour));
}

export async function getTour(
  repoRoot: string,
  id: string,
): Promise<Tour> {
  const content = await readFile(tourPath(repoRoot, id), "utf-8");
  return parseTOML(content) as unknown as Tour;
}

export async function listTours(
  repoRoot: string,
  opts?: { status?: "open" | "closed" | "all" },
): Promise<Tour[]> {
  const base = join(repoRoot, ".tour");
  let entries: string[];
  try {
    entries = await readdir(base);
  } catch {
    return [];
  }
  const tours: Tour[] = [];
  for (const entry of entries) {
    try {
      const tour = await getTour(repoRoot, entry);
      tours.push(tour);
    } catch {}
  }
  const status = opts?.status ?? "open";
  const filtered =
    status === "all" ? tours : tours.filter((t) => t.status === status);
  return filtered.sort((a, b) => a.id.localeCompare(b.id));
}

export async function updateTourStatus(
  repoRoot: string,
  id: string,
  status: "open" | "closed",
): Promise<Tour> {
  const tour = await getTour(repoRoot, id);
  tour.status = status;
  if (status === "closed") {
    tour.closed_at = new Date().toISOString();
  }
  await writeFile(tourPath(repoRoot, id), stringifyTOML(tour));
  return tour;
}

export async function deleteTour(
  repoRoot: string,
  id: string,
): Promise<void> {
  await rm(tourDir(repoRoot, id), { recursive: true, force: true });
}

export async function resolveIdPrefix(
  repoRoot: string,
  prefix: string,
): Promise<string> {
  const base = join(repoRoot, ".tour");
  let entries: string[];
  try {
    entries = await readdir(base);
  } catch {
    // Issue #369: distinguish "no `.tour/` directory at this root" from
    // "the prefix doesn't match anything in `.tour/`". The path is the
    // resolved tour-root (not `<root>/.tour`) so the message names the
    // place the user can `cd` to or `tour create` from.
    throw new Error(`No .tour/ directory at ${repoRoot}`);
  }
  const matches = entries.filter((e) => e.startsWith(prefix));
  if (matches.length === 0) {
    throw new Error(`No tour matching prefix "${prefix}"`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous prefix "${prefix}": ${matches.join(", ")}`,
    );
  }
  return matches[0];
}

export async function pruneTours(
  repoRoot: string,
  olderThanMs: number,
): Promise<string[]> {
  const tours = await listTours(repoRoot, { status: "closed" });
  const now = Date.now();
  const pruned: string[] = [];
  for (const tour of tours) {
    const age = now - new Date(tour.closed_at).getTime();
    if (age >= olderThanMs) {
      await deleteTour(repoRoot, tour.id);
      pruned.push(tour.id);
    }
  }
  return pruned;
}
