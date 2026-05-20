import { mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml";
import type { Tour } from "./types.js";

function tourDir(tourStoreRoot: string, id: string): string {
  return join(tourStoreRoot, id);
}

function tourPath(tourStoreRoot: string, id: string): string {
  return join(tourDir(tourStoreRoot, id), "tour.toml");
}

export async function createTour(
  tourStoreRoot: string,
  tour: Tour,
): Promise<void> {
  const dir = tourDir(tourStoreRoot, tour.id);
  await mkdir(dir, { recursive: true });
  await writeFile(tourPath(tourStoreRoot, tour.id), stringifyTOML(tour));
}

export async function getTour(
  tourStoreRoot: string,
  id: string,
): Promise<Tour> {
  const content = await readFile(tourPath(tourStoreRoot, id), "utf-8");
  return parseTOML(content) as unknown as Tour;
}

export async function listTours(
  tourStoreRoot: string,
  opts?: { status?: "open" | "closed" | "all" },
): Promise<Tour[]> {
  let entries: string[];
  try {
    entries = await readdir(tourStoreRoot);
  } catch {
    return [];
  }
  const tours: Tour[] = [];
  for (const entry of entries) {
    try {
      const tour = await getTour(tourStoreRoot, entry);
      tours.push(tour);
    } catch {}
  }
  const status = opts?.status ?? "open";
  const filtered =
    status === "all" ? tours : tours.filter((t) => t.status === status);
  return filtered.sort((a, b) => a.id.localeCompare(b.id));
}

export async function updateTourStatus(
  tourStoreRoot: string,
  id: string,
  status: "open" | "closed",
): Promise<Tour> {
  const tour = await getTour(tourStoreRoot, id);
  tour.status = status;
  if (status === "closed") {
    tour.closed_at = new Date().toISOString();
  }
  await writeFile(tourPath(tourStoreRoot, id), stringifyTOML(tour));
  return tour;
}

export async function deleteTour(
  tourStoreRoot: string,
  id: string,
): Promise<void> {
  await rm(tourDir(tourStoreRoot, id), { recursive: true, force: true });
}

export async function resolveIdPrefix(
  tourStoreRoot: string,
  prefix: string,
): Promise<string> {
  let entries: string[];
  try {
    entries = await readdir(tourStoreRoot);
  } catch {
    throw new Error(`No tour store directory at ${tourStoreRoot}`);
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
  tourStoreRoot: string,
  olderThanMs: number,
): Promise<string[]> {
  const tours = await listTours(tourStoreRoot, { status: "closed" });
  const now = Date.now();
  const pruned: string[] = [];
  for (const tour of tours) {
    const age = now - new Date(tour.closed_at).getTime();
    if (age >= olderThanMs) {
      await deleteTour(tourStoreRoot, tour.id);
      pruned.push(tour.id);
    }
  }
  return pruned;
}
