#!/usr/bin/env node

import { create } from "./cli/create.js";
import { annotate } from "./cli/annotate.js";
import { list } from "./cli/list.js";
import { show } from "./cli/show.js";
import { close } from "./cli/close.js";
import { del } from "./cli/delete.js";
import { prune } from "./cli/prune.js";
import { tui } from "./cli/tui.js";

function parseArgs(argv: string[]): {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
} {
  const args = argv.slice(2);
  const command = args[0] ?? "";
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { command, positional, flags };
}

function flag(flags: Record<string, string | boolean>, key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

function boolFlag(flags: Record<string, string | boolean>, key: string): boolean {
  return flags[key] === true;
}

const USAGE = `review — local code review tool with AI annotations

Usage:
  review                                  (open TUI for most recent review)
  review tui [<id>]                       (open TUI for a specific review)
  review create --head <ref> [--base <ref>] [--title <s>] [--json]
  review annotate <id> --file <f> --side <s> --line <n[-m]> --body <b> [--author <a>] [--json]
  review annotate <id> --batch - [--json]
  review list [--status open|closed|all] [--json]
  review show <id> [--json]
  review close <id> [--json]
  review delete <id> [--json]
  review prune --older-than <duration> [--json]
`;

async function main(): Promise<void> {
  const { command, positional, flags } = parseArgs(process.argv);
  const cwd = process.cwd();
  const json = boolFlag(flags, "json");

  try {
    switch (command) {
      case "create":
        await create({
          head: flag(flags, "head") ?? (() => { throw new Error("--head is required"); })(),
          base: flag(flags, "base"),
          title: flag(flags, "title"),
          json,
          cwd,
        });
        break;

      case "annotate": {
        const reviewId = positional[0];
        if (!reviewId) throw new Error("Usage: review annotate <id> ...");
        await annotate({
          reviewId,
          file: flag(flags, "file"),
          side: flag(flags, "side"),
          line: flag(flags, "line"),
          body: flag(flags, "body"),
          author: flag(flags, "author"),
          batch: boolFlag(flags, "batch") || flag(flags, "batch") === "-",
          json,
          cwd,
        });
        break;
      }

      case "list":
        await list({
          status: (flag(flags, "status") as "open" | "closed" | "all") ?? "open",
          json,
          cwd,
        });
        break;

      case "show": {
        const reviewId = positional[0];
        if (!reviewId) throw new Error("Usage: review show <id>");
        await show({ reviewId, json, cwd });
        break;
      }

      case "close": {
        const reviewId = positional[0];
        if (!reviewId) throw new Error("Usage: review close <id>");
        await close({ reviewId, json, cwd });
        break;
      }

      case "delete": {
        const reviewId = positional[0];
        if (!reviewId) throw new Error("Usage: review delete <id>");
        await del({ reviewId, json, cwd });
        break;
      }

      case "prune": {
        const olderThan = flag(flags, "older-than");
        if (!olderThan) throw new Error("--older-than is required");
        await prune({ olderThan, json, cwd });
        break;
      }

      case "tui":
        await tui({ reviewId: positional[0], cwd });
        break;

      case "help":
      case "--help":
        console.log(USAGE);
        break;

      case "":
        await tui({ cwd });
        break;

      default:
        console.error(`Unknown command: ${command}\n`);
        console.error(USAGE);
        process.exitCode = 1;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (json) {
      console.error(JSON.stringify({ error: message }));
    } else {
      console.error(`Error: ${message}`);
    }
    process.exitCode = 1;
  }
}

main();
