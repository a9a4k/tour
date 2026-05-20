import {
  createComment,
  createComments,
  createDelete,
  createReply,
  type CreateRequest,
} from "../core/comments-store.js";
import { resolveIdPrefix } from "../core/tour-store.js";
import { loadTourBundle } from "../core/tour-bundle.js";
import { printOutput } from "./output.js";
import { parseBatch, type BatchItem } from "./parse-batch.js";
import type { AuthorKind } from "../core/types.js";

interface CommentArgs {
  tourId: string;
  file?: string;
  side?: string;
  line?: string;
  body?: string;
  author?: string;
  asAgent?: boolean;
  asHuman?: boolean;
  replyTo?: string;
  deleteId?: string;
  batch?: boolean;
  json: boolean;
  cwd: string;
  tourStoreRoot?: string;
}

function parseLine(line: string): { start: number; end: number } {
  const parts = line.split("-");
  const start = parseInt(parts[0], 10);
  const end = parts.length > 1 ? parseInt(parts[1], 10) : start;
  if (isNaN(start) || isNaN(end)) throw new Error(`Invalid line range: ${line}`);
  if (end < start) throw new Error(`Invalid line range: end (${end}) < start (${start})`);
  return { start, end };
}

// Batch items may carry either the legacy `line` range-string (e.g. "12-14")
// or the storage-native `line_start` integer + optional `line_end` integer.
// Both forms map to the same persisted anchor.
function resolveAnchor(item: BatchItem): { start: number; end: number } {
  if (item.line_start !== undefined) {
    const start = item.line_start;
    const end = item.line_end ?? start;
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      throw new Error(
        `Invalid line_start/line_end: must be integers (got ${start}/${end})`,
      );
    }
    if (end < start) {
      throw new Error(`Invalid line range: end (${end}) < start (${start})`);
    }
    return { start, end };
  }
  if (item.line !== undefined) return parseLine(item.line);
  throw new Error("Batch item missing line or line_start");
}

function resolveAuthorKind(asAgent?: boolean, asHuman?: boolean): AuthorKind {
  if (asAgent && asHuman) {
    throw new Error("--as-agent and --as-human are mutually exclusive");
  }
  if (asHuman) return "human";
  return "agent";
}

export async function comment(args: CommentArgs): Promise<void> {
  const tourStoreRoot = args.tourStoreRoot ?? args.cwd;
  // Delete verb (Slice C / issue #387 / ADR 0036). Mutually exclusive
  // with the create / reply flag families. `--as-agent --delete` is
  // refused here — before any I/O — so the humans-only protocol error
  // surfaces at parse-time as the PRD requires.
  if (args.deleteId !== undefined) {
    if (args.asAgent) {
      throw new Error(
        "--as-agent --delete is refused: comment.deleted is humans-only (ADR 0036)",
      );
    }
    if (
      args.file !== undefined ||
      args.side !== undefined ||
      args.line !== undefined ||
      args.body !== undefined ||
      args.replyTo !== undefined ||
      args.batch
    ) {
      throw new Error(
        "--delete is mutually exclusive with --file/--side/--line/--body, --reply-to, and --batch",
      );
    }
    const resolvedIdForDelete = await resolveIdPrefix(tourStoreRoot, args.tourId);
    const result = await createDelete(tourStoreRoot, resolvedIdForDelete, {
      target_id: args.deleteId,
      by_kind: "human",
    });
    if (args.json) {
      printOutput({ deleted: result.target_id }, true);
    } else {
      console.log(`Deleted comment ${result.target_id}`);
    }
    return;
  }

  const resolvedId = await resolveIdPrefix(tourStoreRoot, args.tourId);
  const authorKind = resolveAuthorKind(args.asAgent, args.asHuman);

  if (args.batch) {
    // Issue #396: an agent that follows the `tour comment ... --batch -`
    // shape but passes `--as-human` is almost always a self-identity
    // mistake (the audience is the human reviewer; the author is the
    // agent). Non-TTY stdin distinguishes the agent-shaped invocation
    // from a legitimate interactive human pipeline. Nudge, don't refuse
    // — the warning is captured in agent transcripts so the mistake is
    // caught in the same turn. `isTTY` is `true` when attached to a
    // terminal and `undefined` otherwise — falsy covers the non-TTY
    // case (piped stdin, redirected file, etc.).
    if (args.asHuman && !process.stdin.isTTY) {
      console.error(
        "tour: warning: --as-human with --batch - on non-TTY stdin looks like an agent self-mis-identifying as human (issue #396). If you are an agent, drop --as-human (or pass --as-agent) so the audit trail records your identity correctly.",
      );
    }
    const stdin = await readStdin();
    const items = parseBatch(stdin);
    const requests: CreateRequest[] = items.map((item) => {
      const itemKind = item.author_kind ?? authorKind;
      // Issue #396: `--author` cascades into batch items the same way
      // `--as-agent` / `--as-human` already do. Per-item `author` in the
      // JSONL still wins (symmetric with `item.author_kind ?? authorKind`).
      const itemAuthor = item.author ?? args.author;
      if (item.thread_id !== undefined) {
        if (item.body === undefined) {
          throw new Error("Batch reply item missing body");
        }
        return {
          kind: "reply",
          thread_id: item.thread_id,
          body: item.body,
          author: itemAuthor,
          author_kind: itemKind,
        };
      }
      if (item.file === undefined || item.side === undefined || item.body === undefined) {
        throw new Error("Batch item missing file, side, or body");
      }
      const { start, end } = resolveAnchor(item);
      return {
        kind: "top-level",
        file: item.file,
        side: validateSide(item.side),
        line_start: start,
        line_end: end,
        body: item.body,
        author: itemAuthor,
        author_kind: itemKind,
      };
    });
    // Single bundle load for the whole batch — PRD #140 / slice 4 #144.
    const bundle = await loadTourBundle(tourStoreRoot, resolvedId, args.cwd);
    const comments = await createComments(tourStoreRoot, resolvedId, requests, bundle);
    if (args.json) {
      printOutput(comments, true);
    } else {
      console.log(`Added ${comments.length} comments to ${resolvedId}`);
    }
    return;
  }

  if (args.replyTo) {
    if (!args.body) {
      throw new Error("--body is required (with --reply-to)");
    }
    // Reply path inherits its anchor from the parent (which is already
    // inside the diff by construction), so no bundle load — keeps the
    // reply path cheap.
    const reply = await createReply(tourStoreRoot, resolvedId, {
      thread_id: args.replyTo,
      body: args.body,
      author: args.author,
      author_kind: authorKind,
    });
    if (args.json) {
      printOutput(reply, true);
    } else {
      console.log(`Added reply to ${args.replyTo} in ${resolvedId}`);
    }
    return;
  }

  if (!args.file || !args.side || !args.line || !args.body) {
    throw new Error(
      "Required flags: --file, --side, --line, --body (or use --batch -, or --reply-to)",
    );
  }

  const { start, end } = parseLine(args.line);
  const bundle = await loadTourBundle(tourStoreRoot, resolvedId, args.cwd);
  const created = await createComment(
    tourStoreRoot,
    resolvedId,
    {
      file: args.file,
      side: validateSide(args.side),
      line_start: start,
      line_end: end,
      body: args.body,
      author: args.author,
      author_kind: authorKind,
    },
    bundle,
  );

  if (args.json) {
    printOutput(created, true);
  } else {
    console.log(`Added comment to ${resolvedId}: ${args.file}:${start}`);
  }
}

function validateSide(side: string): "additions" | "deletions" {
  if (side !== "additions" && side !== "deletions") {
    throw new Error(`Invalid side "${side}": must be "additions" or "deletions"`);
  }
  return side;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}
