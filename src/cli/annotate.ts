import {
  createAnnotation,
  createAnnotations,
  createReply,
  type CreateRequest,
} from "../core/annotations-store.js";
import { resolveIdPrefix } from "../core/tour-store.js";
import { loadTourBundle } from "../core/tour-bundle.js";
import { printOutput } from "./output.js";
import type { AuthorKind } from "../core/types.js";

interface AnnotateArgs {
  tourId: string;
  file?: string;
  side?: string;
  line?: string;
  body?: string;
  author?: string;
  asAgent?: boolean;
  asHuman?: boolean;
  replyTo?: string;
  batch?: boolean;
  json: boolean;
  cwd: string;
}

function parseLine(line: string): { start: number; end: number } {
  const parts = line.split("-");
  const start = parseInt(parts[0], 10);
  const end = parts.length > 1 ? parseInt(parts[1], 10) : start;
  if (isNaN(start) || isNaN(end)) throw new Error(`Invalid line range: ${line}`);
  if (end < start) throw new Error(`Invalid line range: end (${end}) < start (${start})`);
  return { start, end };
}

function resolveAuthorKind(asAgent?: boolean, asHuman?: boolean): AuthorKind {
  if (asAgent && asHuman) {
    throw new Error("--as-agent and --as-human are mutually exclusive");
  }
  if (asHuman) return "human";
  return "agent";
}

export async function annotate(args: AnnotateArgs): Promise<void> {
  const resolvedId = await resolveIdPrefix(args.cwd, args.tourId);
  const authorKind = resolveAuthorKind(args.asAgent, args.asHuman);

  if (args.batch) {
    const stdin = await readStdin();
    const items = JSON.parse(stdin) as Array<{
      file: string;
      side: string;
      line: string;
      body: string;
      author?: string;
      author_kind?: AuthorKind;
      replies_to?: string;
    }>;
    const requests: CreateRequest[] = items.map((item) => {
      const itemKind = item.author_kind ?? authorKind;
      if (item.replies_to !== undefined) {
        return {
          kind: "reply",
          replies_to: item.replies_to,
          body: item.body,
          author: item.author,
          author_kind: itemKind,
        };
      }
      const { start, end } = parseLine(item.line);
      return {
        kind: "top-level",
        file: item.file,
        side: validateSide(item.side),
        line_start: start,
        line_end: end,
        body: item.body,
        author: item.author,
        author_kind: itemKind,
      };
    });
    // Single bundle load for the whole batch — PRD #140 / slice 4 #144.
    const bundle = await loadTourBundle(args.cwd, resolvedId);
    const annotations = await createAnnotations(args.cwd, resolvedId, requests, bundle);
    if (args.json) {
      printOutput(annotations, true);
    } else {
      console.log(`Added ${annotations.length} annotations to ${resolvedId}`);
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
    const reply = await createReply(args.cwd, resolvedId, {
      replies_to: args.replyTo,
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
  const bundle = await loadTourBundle(args.cwd, resolvedId);
  const annotation = await createAnnotation(
    args.cwd,
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
    printOutput(annotation, true);
  } else {
    console.log(`Added annotation to ${resolvedId}: ${args.file}:${start}`);
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
