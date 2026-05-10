import {
  appendAnnotation,
  appendAnnotations,
  readAnnotations,
} from "../core/annotations-store.js";
import { resolveIdPrefix } from "../core/tour-store.js";
import { generateId } from "../core/ids.js";
import { printOutput } from "./output.js";
import type { Annotation, AuthorKind } from "../core/types.js";

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
    const existing = await readAnnotations(args.cwd, resolvedId);
    const annotations: Annotation[] = items.map((item) => {
      if (item.replies_to !== undefined) {
        return buildReply(item, existing, authorKind);
      }
      const { start, end } = parseLine(item.line);
      return {
        id: generateId(),
        file: item.file,
        side: validateSide(item.side),
        line_start: start,
        line_end: end,
        body: item.body,
        author: item.author ?? "unknown",
        author_kind: item.author_kind ?? authorKind,
        created_at: new Date().toISOString(),
      };
    });
    await appendAnnotations(args.cwd, resolvedId, annotations);
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
    const existing = await readAnnotations(args.cwd, resolvedId);
    const reply = buildReply(
      {
        replies_to: args.replyTo,
        body: args.body,
        author: args.author,
      },
      existing,
      authorKind,
    );
    await appendAnnotation(args.cwd, resolvedId, reply);
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
  const annotation: Annotation = {
    id: generateId(),
    file: args.file,
    side: validateSide(args.side),
    line_start: start,
    line_end: end,
    body: args.body,
    author: args.author ?? "unknown",
    author_kind: authorKind,
    created_at: new Date().toISOString(),
  };

  await appendAnnotation(args.cwd, resolvedId, annotation);

  if (args.json) {
    printOutput(annotation, true);
  } else {
    console.log(`Added annotation to ${resolvedId}: ${args.file}:${start}`);
  }
}

interface ReplyInput {
  replies_to?: string;
  body: string;
  author?: string;
  author_kind?: AuthorKind;
}

function buildReply(
  input: ReplyInput,
  existing: Annotation[],
  defaultKind: AuthorKind,
): Annotation {
  if (!input.replies_to) {
    throw new Error("replies_to is required for a reply");
  }
  const parent = existing.find((a) => a.id === input.replies_to);
  if (!parent) {
    throw new Error(`No annotation with id "${input.replies_to}" in this tour`);
  }
  return {
    id: generateId(),
    file: parent.file,
    side: parent.side,
    line_start: parent.line_start,
    line_end: parent.line_end,
    body: input.body,
    author: input.author ?? "unknown",
    author_kind: input.author_kind ?? defaultKind,
    replies_to: input.replies_to,
    created_at: new Date().toISOString(),
  };
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
