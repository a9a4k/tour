import {
  appendAnnotation,
  appendAnnotations,
} from "../core/annotations-store.js";
import { resolveIdPrefix } from "../core/review-store.js";
import { generateId } from "../core/ids.js";
import { printOutput } from "./output.js";
import type { Annotation } from "../core/types.js";

interface AnnotateArgs {
  reviewId: string;
  file?: string;
  side?: string;
  line?: string;
  body?: string;
  author?: string;
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

export async function annotate(args: AnnotateArgs): Promise<void> {
  const resolvedId = await resolveIdPrefix(args.cwd, args.reviewId);

  if (args.batch) {
    const stdin = await readStdin();
    const items = JSON.parse(stdin) as Array<{
      file: string;
      side: string;
      line: string;
      body: string;
      author?: string;
    }>;
    const annotations: Annotation[] = items.map((item) => {
      const { start, end } = parseLine(item.line);
      return {
        id: generateId(),
        file: item.file,
        side: validateSide(item.side),
        line_start: start,
        line_end: end,
        body: item.body,
        author: item.author ?? "unknown",
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

  if (!args.file || !args.side || !args.line || !args.body) {
    throw new Error(
      "Required flags: --file, --side, --line, --body (or use --batch -)",
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
    created_at: new Date().toISOString(),
  };

  await appendAnnotation(args.cwd, resolvedId, annotation);

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
