#!/usr/bin/env bun

import { create } from "./cli/create.js";
import { annotate } from "./cli/annotate.js";
import { list } from "./cli/list.js";
import { show } from "./cli/show.js";
import { close } from "./cli/close.js";
import { del } from "./cli/delete.js";
import { prune } from "./cli/prune.js";
import { tui } from "./cli/tui.js";
import { serve } from "./cli/serve.js";

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

const USAGE = `tour — local code review tool with AI annotations

Usage:
  tour                                  (open TUI for most recent tour)
  tour tui [<id>]                       (open TUI for a specific tour)
  tour serve [--port 7777] [--open] [<id>] (start webapp)
  tour create --head <ref> [--base <ref>] [--title <s>] [--json]
  tour annotate <id> --file <f> --side <s> --line <n[-m]> --body <b> [--author <a>] [--json]
  tour annotate <id> --batch - [--json]
  tour list [--status open|closed|all] [--json]
  tour show <id> [--json]
  tour close <id> [--json]
  tour delete <id> [--json]
  tour prune --older-than <duration> [--json]
`;

async function main(): Promise<void> {
  const { command, positional, flags } = parseArgs(process.argv);
  const cwd = process.cwd();
  const json = boolFlag(flags, "json");

  try {
    switch (command) {
      case "create": {
        const head = flag(flags, "head");
        if (!head) throw new Error("--head is required");
        await create({ head, base: flag(flags, "base"), title: flag(flags, "title"), json, cwd });
        break;
      }

      case "annotate": {
        const tourId = positional[0];
        if (!tourId) throw new Error("Usage: tour annotate <id> ...");
        await annotate({
          tourId,
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
        const tourId = positional[0];
        if (!tourId) throw new Error("Usage: tour show <id>");
        await show({ tourId, json, cwd });
        break;
      }

      case "close": {
        const tourId = positional[0];
        if (!tourId) throw new Error("Usage: tour close <id>");
        await close({ tourId, json, cwd });
        break;
      }

      case "delete": {
        const tourId = positional[0];
        if (!tourId) throw new Error("Usage: tour delete <id>");
        await del({ tourId, json, cwd });
        break;
      }

      case "prune": {
        const olderThan = flag(flags, "older-than");
        if (!olderThan) throw new Error("--older-than is required");
        await prune({ olderThan, json, cwd });
        break;
      }

      case "tui":
        await tui({ tourId: positional[0], cwd });
        break;

      case "serve":
        await serve({
          port: parseInt(flag(flags, "port") ?? "7777", 10),
          open: boolFlag(flags, "open"),
          tourId: positional[0],
          cwd,
        });
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
