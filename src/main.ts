#!/usr/bin/env bun

import { create } from "./cli/create.js";
import { annotate } from "./cli/annotate.js";
import { list } from "./cli/list.js";
import { show } from "./cli/show.js";
import { close } from "./cli/close.js";
import { del } from "./cli/delete.js";
import { prune } from "./cli/prune.js";
import { pickup } from "./cli/pickup.js";
import { tui } from "./cli/tui.js";
import { serve } from "./cli/serve.js";
import { selftestSyntax } from "./cli/selftest.js";
import { listTours } from "./core/tour-store.js";
import { pickDefaultSurface } from "./core/surface-picker.js";
import { isOnPath } from "./core/is-on-path.js";

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

// 8687 is the documented default; `TOURDIFF_BASE_PORT` lets the tests
// (and any user who wants a different preferred port without typing
// `--port` every time) override it. Non-integer / non-positive values
// fall back to 8687.
function defaultPreferredPort(): number {
  const raw = process.env.TOURDIFF_BASE_PORT;
  if (raw === undefined || raw === "") return 8687;
  const parsed = parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 8687;
}

const USAGE = `tour — local code walkthrough tool with AI annotations

Usage:
  tour                                  (open the best surface for your env: webapp on a desktop with a browser, TUI otherwise)
  tour tui [<id>] [--reply-agent <name>]   (open TUI for a specific tour)
  tour serve [--port 8687] [--open] [<id>] [--reply-agent <name>] (start webapp; 8687 = TOUR on T9, auto-falls-back if busy)
  tour create --head <ref> [--base <ref>] [--title <s>] [--json]
                                        (default --base: merge-base with HEAD's upstream when the branch is multi-commit; else HEAD^. Detached HEAD, no upstream, or single-commit branches fall back to HEAD^.)
  tour annotate <id> --file <f> --side <s> --line <n[-m]> --body <b> [--author <a>] [--as-agent|--as-human] [--json]
  tour annotate <id> --reply-to <ann-id> --body <b> [--author <a>] [--as-agent|--as-human] [--json]
  tour annotate <id> --batch - [--json]
  tour list [--status open|closed|all] [--json]
  tour show <id> [--json]
  tour close <id> [--json]
  tour delete <id> [--json]
  tour prune --older-than <duration> [--json]
  tour pickup <id> [--json]
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
    tour                                  # webapp on a desktop, TUI otherwise
    tour tui                              # force the TUI
    tour serve                            # force the webapp at http://127.0.0.1:8687

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

      case "pickup": {
        const tourId = positional[0];
        if (!tourId) throw new Error("Usage: tour pickup <id> [--json]");
        await pickup({ tourId, json, cwd });
        break;
      }

      case "tui":
        await tui({
          tourId: positional[0],
          cwd,
          replyAgent: flag(flags, "reply-agent"),
        });
        break;

      case "serve": {
        const portFlag = flag(flags, "port");
        await serve({
          port: portFlag !== undefined ? parseInt(portFlag, 10) : defaultPreferredPort(),
          portExplicit: portFlag !== undefined,
          open: boolFlag(flags, "open"),
          tourId: positional[0],
          cwd,
          replyAgent: flag(flags, "reply-agent"),
        });
        break;
      }

      // Hidden — exercised only by scripts/smoke-binary.sh. Not advertised
      // in USAGE to keep the user-facing surface small. Exits 0 if the
      // tree-sitter worker booted and returned tokens for a TS sample,
      // non-zero otherwise. See src/tui/selftest-runner.ts.
      case "selftest-syntax":
        await selftestSyntax();
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
        // Smart-default surface (issue #174): webapp when a browser is
        // reachable, TUI otherwise. Explicit `tour tui` / `tour serve` are
        // unchanged. Env collection lives here; pickDefaultSurface is pure.
        //
        // Bare `tour` starts the webapp and prints the URL but does NOT
        // auto-open the browser — modern terminals make `http://…` URLs
        // Cmd/Ctrl-clickable, and auto-opening on every invocation pollutes
        // the user's tab history. Users who want the old auto-open behavior
        // run `tour serve --open` explicitly.
        const surface = pickDefaultSurface({
          platform: process.platform,
          ssh:
            (process.env.SSH_TTY ?? "") !== "" ||
            (process.env.SSH_CONNECTION ?? "") !== "",
          isTTY: Boolean(process.stdout.isTTY),
          hasOpenCommand:
            process.platform === "darwin"
              ? isOnPath("open")
              : isOnPath("xdg-open"),
        });
        if (surface === "webapp") {
          await serve({
            port: defaultPreferredPort(),
            portExplicit: false,
            open: false,
            cwd,
            replyAgent: flag(flags, "reply-agent"),
          });
        } else {
          await tui({ cwd, replyAgent: flag(flags, "reply-agent") });
        }
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
