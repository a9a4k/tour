import { mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml";
import type { Review } from "./types.js";

function reviewDir(repoRoot: string, id: string): string {
  return join(repoRoot, ".review", id);
}

function reviewPath(repoRoot: string, id: string): string {
  return join(reviewDir(repoRoot, id), "review.toml");
}

export async function createReview(
  repoRoot: string,
  review: Review,
): Promise<void> {
  const dir = reviewDir(repoRoot, review.id);
  await mkdir(dir, { recursive: true });
  await writeFile(reviewPath(repoRoot, review.id), stringifyTOML(review));
}

export async function getReview(
  repoRoot: string,
  id: string,
): Promise<Review> {
  const content = await readFile(reviewPath(repoRoot, id), "utf-8");
  return parseTOML(content) as unknown as Review;
}

export async function listReviews(
  repoRoot: string,
  opts?: { status?: "open" | "closed" | "all" },
): Promise<Review[]> {
  const base = join(repoRoot, ".review");
  let entries: string[];
  try {
    entries = await readdir(base);
  } catch {
    return [];
  }
  const reviews: Review[] = [];
  for (const entry of entries) {
    try {
      const review = await getReview(repoRoot, entry);
      reviews.push(review);
    } catch {}
  }
  const status = opts?.status ?? "open";
  const filtered =
    status === "all" ? reviews : reviews.filter((r) => r.status === status);
  return filtered.sort((a, b) => a.id.localeCompare(b.id));
}

export async function updateReviewStatus(
  repoRoot: string,
  id: string,
  status: "open" | "closed",
): Promise<Review> {
  const review = await getReview(repoRoot, id);
  review.status = status;
  if (status === "closed") {
    review.closed_at = new Date().toISOString();
  }
  await writeFile(reviewPath(repoRoot, id), stringifyTOML(review));
  return review;
}

export async function deleteReview(
  repoRoot: string,
  id: string,
): Promise<void> {
  await rm(reviewDir(repoRoot, id), { recursive: true, force: true });
}

export async function resolveIdPrefix(
  repoRoot: string,
  prefix: string,
): Promise<string> {
  const base = join(repoRoot, ".review");
  let entries: string[];
  try {
    entries = await readdir(base);
  } catch {
    throw new Error(`No reviews found`);
  }
  const matches = entries.filter((e) => e.startsWith(prefix));
  if (matches.length === 0) {
    throw new Error(`No review matching prefix "${prefix}"`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous prefix "${prefix}": ${matches.join(", ")}`,
    );
  }
  return matches[0];
}

export async function pruneReviews(
  repoRoot: string,
  olderThanMs: number,
): Promise<string[]> {
  const reviews = await listReviews(repoRoot, { status: "closed" });
  const now = Date.now();
  const pruned: string[] = [];
  for (const review of reviews) {
    const age = now - new Date(review.closed_at).getTime();
    if (age >= olderThanMs) {
      await deleteReview(repoRoot, review.id);
      pruned.push(review.id);
    }
  }
  return pruned;
}
