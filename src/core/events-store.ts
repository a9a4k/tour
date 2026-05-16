import { readFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { TourEvent } from "./types.js";

// On-disk event log per ADR 0036. One file per Tour at
// `.tour/<id>/tour-events.jsonl`, append-only JSONL. POSIX `O_APPEND`
// writes serialise naturally across the four writers (CLI / TUI / webapp
// / reply-runner); no lock concept beyond what the codebase already
// relies on for the snapshot log it replaces.
const EVENTS_FILENAME = "tour-events.jsonl";

export function eventsPath(repoRoot: string, tourId: string): string {
  return join(repoRoot, ".tour", tourId, EVENTS_FILENAME);
}

export async function appendEvent(
  repoRoot: string,
  tourId: string,
  event: TourEvent,
): Promise<void> {
  await appendFile(eventsPath(repoRoot, tourId), JSON.stringify(event) + "\n");
}

export async function appendEvents(
  repoRoot: string,
  tourId: string,
  events: TourEvent[],
): Promise<void> {
  if (events.length === 0) return;
  const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await appendFile(eventsPath(repoRoot, tourId), lines);
}

function isAuthorKind(v: unknown): v is "agent" | "human" {
  return v === "agent" || v === "human";
}

function isSide(v: unknown): v is "additions" | "deletions" {
  return v === "additions" || v === "deletions";
}

// Type-narrowing reader at the storage boundary. Malformed lines (bad
// JSON, missing fields, unknown `kind`) are silently dropped — matches
// the snapshot reader's tolerance. The fold is the single place where
// read-time invariants apply; the store stays a thin parser.
function parseEvent(parsed: unknown): TourEvent | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.at !== "string") return null;
  switch (o.kind) {
    case "comment.created": {
      if (
        typeof o.id !== "string" ||
        typeof o.file !== "string" ||
        !isSide(o.side) ||
        typeof o.line_start !== "number" ||
        typeof o.line_end !== "number" ||
        typeof o.body !== "string" ||
        typeof o.author !== "string" ||
        !isAuthorKind(o.author_kind)
      ) {
        return null;
      }
      return {
        kind: "comment.created",
        id: o.id,
        file: o.file,
        side: o.side,
        line_start: o.line_start,
        line_end: o.line_end,
        body: o.body,
        author: o.author,
        author_kind: o.author_kind,
        at: o.at,
      };
    }
    case "reply.created": {
      if (
        typeof o.id !== "string" ||
        typeof o.replies_to !== "string" ||
        typeof o.body !== "string" ||
        typeof o.author !== "string" ||
        !isAuthorKind(o.author_kind)
      ) {
        return null;
      }
      return {
        kind: "reply.created",
        id: o.id,
        replies_to: o.replies_to,
        body: o.body,
        author: o.author,
        author_kind: o.author_kind,
        at: o.at,
      };
    }
    case "comment.deleted": {
      if (typeof o.target_id !== "string") return null;
      return { kind: "comment.deleted", target_id: o.target_id, at: o.at };
    }
    default:
      return null;
  }
}

export async function readEvents(
  repoRoot: string,
  tourId: string,
): Promise<TourEvent[]> {
  let content: string;
  try {
    content = await readFile(eventsPath(repoRoot, tourId), "utf-8");
  } catch {
    return [];
  }
  const events: TourEvent[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const ev = parseEvent(parsed);
    if (ev) events.push(ev);
  }
  return events;
}
