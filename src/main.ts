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
import { replyCancel } from "./cli/reply-cancel.js";
import { replySystemPrompt } from "./cli/reply-system-prompt.js";
import { listTours } from "./core/tour-store.js";

declare const __EMBEDDED_VERSION__: string;
const VERSION =
  typeof __EMBEDDED_VERSION__ !== "undefined" ? __EMBEDDED_VERSION__ : "dev";

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
  tour tui [<id>] [--reply-agent <name>]   (open TUI for a specific tour)
  tour serve [--port 7777] [--open] [<id>] [--reply-agent <name>] (start webapp)
  tour create --head <ref> [--base <ref>] [--title <s>] [--json]
  tour annotate <id> --file <f> --side <s> --line <n[-m]> --body <b> [--author <a>] [--as-agent|--as-human] [--json]
  tour annotate <id> --reply-to <ann-id> --body <b> [--author <a>] [--as-agent|--as-human] [--json]
  tour annotate <id> --batch - [--json]
  tour list [--status open|closed|all] [--json]
  tour show <id> [--json]
  tour close <id> [--json]
  tour delete <id> [--json]
  tour prune --older-than <duration> [--json]
  tour reply-cancel <id> [--json]       (kill a stuck reply-agent + clear the lock)
  tour reply-system-prompt              (print canonical reply-agent system prompt)
  tour --version
  tour --help
`;

function firstRunBanner(): string {
  return `tour ${VERSION} — local code review with AI annotations.

  No tours found in this repo.

  Create one:
    tour create --head HEAD              # tour the latest commit
    tour create --head WIP                # tour your uncommitted changes
    tour create --head HEAD --base main   # tour a branch

  Then open:
    tour                                  # TUI
    tour serve                            # webapp at http://127.0.0.1:7777

  Docs: https://github.com/a9a4k/tour`;
}

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
          asAgent: boolFlag(flags, "as-agent"),
          asHuman: boolFlag(flags, "as-human"),
          replyTo: flag(flags, "reply-to"),
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
        await tui({
          tourId: positional[0],
          cwd,
          replyAgent: flag(flags, "reply-agent"),
        });
        break;

      case "serve":
        await serve({
          port: parseInt(flag(flags, "port") ?? "7777", 10),
          open: boolFlag(flags, "open"),
          tourId: positional[0],
          cwd,
          replyAgent: flag(flags, "reply-agent"),
        });
        break;

      case "reply-cancel": {
        const tourId = positional[0];
        if (!tourId) throw new Error("Usage: tour reply-cancel <id>");
        await replyCancel({ tourId, json, cwd });
        break;
      }

      case "reply-system-prompt":
        replySystemPrompt();
        break;

      case "help":
      case "--help":
      case "-h":
        console.log(USAGE);
        break;

      case "version":
      case "--version":
      case "-v":
        console.log(`tour ${VERSION}`);
        break;

      case "": {
        const tours = await listTours(cwd, { status: "all" }).catch(() => []);
        if (tours.length === 0) {
          console.log(firstRunBanner());
          break;
        }
        await tui({ cwd, replyAgent: flag(flags, "reply-agent") });
        break;
      }

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
