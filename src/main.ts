#!/usr/bin/env bun

import { join } from "node:path";
import { create } from "./cli/create.js";
import { comment } from "./cli/comment.js";
import { list } from "./cli/list.js";
import { show } from "./cli/show.js";
import { close } from "./cli/close.js";
import { del } from "./cli/delete.js";
import { prune } from "./cli/prune.js";
import { pickup } from "./cli/pickup.js";
import { configShow } from "./cli/config.js";
import { tui } from "./cli/tui.js";
import { serve } from "./cli/serve.js";
import { listTours } from "./core/tour-store.js";
import { pickDefaultSurface } from "./core/surface-picker.js";
import { isOnPath } from "./core/is-on-path.js";
import { resolveEditor } from "./core/editor-config.js";
import { resolveTourLocation } from "./core/tour-location.js";
import { tourHome } from "./core/tour-home.js";
import { loadUserConfig } from "./core/user-config.js";
import { parseArgs } from "./core/parse-args.js";
import { isNotGitWorkingTreeError } from "./core/not-git-working-tree-error.js";
import { resolveReplyAgentTemplate } from "./core/reply-agent-template.js";

declare const __EMBEDDED_VERSION__: string;
const VERSION =
  typeof __EMBEDDED_VERSION__ !== "undefined" ? __EMBEDDED_VERSION__ : "dev";

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

const USAGE = `tour — local code walkthrough tool with AI comments

Usage:
  tour                                  (open the best surface for your env: webapp on a desktop with a browser, TUI otherwise)
  tour tui [<id>] [--reply-agent <template>] [--editor <cmd>]   (open TUI for a specific tour)
  tour serve [--port 8687] [--open] [<id>] [--reply-agent <template>] [--editor <cmd>] (start webapp; 8687 = TOUR on T9, auto-falls-back if busy)
  tour create --head <ref> [--base <ref>] [--title <s>] [--force] [--json]
                                        (default --base: merge-base with HEAD's upstream when the branch is multi-commit; else HEAD^. Detached HEAD, no upstream, or single-commit branches fall back to HEAD^. --force overrides the duplicate-open-tour refusal.)
  tour comment <id> --file <f> --side <s> --line <n[-m]> --body <b> [--author <a>] [--as-agent|--as-human] [--json]
  tour comment <id> --reply-to <ann-id> --body <b> [--author <a>] [--as-agent|--as-human] [--json]
  tour comment <id> --delete <comment-id> [--json]
  tour comment <id> --edit <comment-id> --body <b> [--as-human] [--json]
  tour comment <id> --batch - [--json]                            (alias: annotate)
  tour list [--all] [--status open|closed|all] [--json]
  tour show <id> [--json]
  tour close <id> [--json]
  tour delete <id> [--json]
  tour prune --older-than <duration> [--json]
  tour pickup <id> [--json]
  tour config show
  tour --version
  tour --help

Defaults:
  --reply-agent uses: CLI flag, then $TOUR_HOME/config.toml, then none.
  --editor uses: CLI flag, then $TOUR_EDITOR, then $TOUR_HOME/config.toml, then $VISUAL, then $EDITOR, then none.

Reply-agent template:
  Whitespace-tokenized command with at least one of {systemPrompt}, {userPrompt}, {combinedPrompt}.
  Example: reply_agent = "claude --print --system-prompt {systemPrompt} {userPrompt}"

Editor template:
  {file} = absolute file path, {line} = line number, {workspace} = current worktree root.
  Example: editor = "code {workspace} -g {file}:{line}"
`;

function firstRunBanner(tourStoreRoot: string, configPath: string): string {
  return `tour ${VERSION} — local code review with AI comments.

  No tours found for this worktree.
  Tours live at: ${tourStoreRoot}
  Defaults at: ${configPath} (optional; run \`tour config show\`)
  Tours from other worktrees are hidden by default; run:
    tour list --all

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
  // `json` is declared outside the try so the catch can still pick the
  // right error format when `parseArgs` itself throws (e.g. `--flag=`
  // with an empty value, issue #393) — before `flags` has been read.
  let json = false;
  try {
    const { command, positional, flags } = parseArgs(process.argv);
    json = boolFlag(flags, "json");

    // Help and version do not touch the tour store and must work outside
    // a git working tree (e.g. `tour --version` in an arbitrary cwd).
    switch (command) {
      case "help":
      case "--help":
      case "-h":
        console.log(USAGE);
        return;
      case "version":
      case "--version":
      case "-v":
        console.log(`tour ${VERSION}`);
        return;
    }

    const tourHomePath = tourHome(process.env);
    if (command === "config") {
      if (positional[0] !== "show") {
        console.error("Usage: tour config show");
        process.exitCode = 1;
        return;
      }
      await configShow(tourHomePath, process.env);
      return;
    }

    const { repoRoot: cwd, tourStoreRoot, worktreeStamp } =
      await resolveTourLocation(process.cwd());
    const userConfig = await loadUserConfig(tourHomePath);
    const configPath = join(tourHomePath, "config.toml");

    switch (command) {
      case "create": {
        const head = flag(flags, "head");
        if (!head) throw new Error("--head is required");
        await create({
          head,
          base: flag(flags, "base"),
          title: flag(flags, "title"),
          force: boolFlag(flags, "force"),
          json,
          cwd,
          tourStoreRoot,
          worktreeStamp,
        });
        break;
      }

      // `comment` is the primary verb per ADR 0029; `annotate` is a
      // permanent silent alias dispatching the same handler. No deprecation
      // warning — agent scripts pinned to the old verb keep working forever.
      case "comment":
      case "annotate": {
        const tourId = positional[0];
        if (!tourId) throw new Error("Usage: tour comment <id> ...");
        await comment({
          tourId,
          file: flag(flags, "file"),
          side: flag(flags, "side"),
          line: flag(flags, "line"),
          body: flag(flags, "body"),
          author: flag(flags, "author"),
          asAgent: boolFlag(flags, "as-agent"),
          asHuman: boolFlag(flags, "as-human"),
          replyTo: flag(flags, "reply-to"),
          deleteId: flag(flags, "delete"),
          editId: flag(flags, "edit"),
          batch: boolFlag(flags, "batch") || flag(flags, "batch") === "-",
          json,
          cwd,
          tourStoreRoot,
        });
        break;
      }

      case "list":
        await list({
          status: (flag(flags, "status") as "open" | "closed" | "all") ?? "open",
          all: boolFlag(flags, "all"),
          json,
          cwd,
          tourStoreRoot,
          worktreeStamp,
        });
        break;

      case "show": {
        const tourId = positional[0];
        if (!tourId) throw new Error("Usage: tour show <id>");
        await show({ tourId, json, cwd, tourStoreRoot });
        break;
      }

      case "close": {
        const tourId = positional[0];
        if (!tourId) throw new Error("Usage: tour close <id>");
        await close({ tourId, json, cwd, tourStoreRoot });
        break;
      }

      case "delete": {
        const tourId = positional[0];
        if (!tourId) throw new Error("Usage: tour delete <id>");
        await del({ tourId, json, cwd, tourStoreRoot });
        break;
      }

      case "prune": {
        const olderThan = flag(flags, "older-than");
        if (!olderThan) throw new Error("--older-than is required");
        await prune({ olderThan, json, cwd, tourStoreRoot });
        break;
      }

      case "pickup": {
        const tourId = positional[0];
        if (!tourId) throw new Error("Usage: tour pickup <id> [--json]");
        await pickup({ tourId, json, cwd, tourStoreRoot });
        break;
      }

      case "tui":
        await tui({
          tourId: positional[0],
          cwd,
          tourStoreRoot,
          worktreeStamp,
          ...resolveReplyAgentTemplate(flag(flags, "reply-agent"), userConfig.replyAgent, configPath),
          configPath,
          editor: resolveEditor(flag(flags, "editor"), process.env, userConfig, cwd),
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
          tourStoreRoot,
          worktreeStamp,
          ...resolveReplyAgentTemplate(flag(flags, "reply-agent"), userConfig.replyAgent, configPath),
          configPath,
          editor: resolveEditor(flag(flags, "editor"), process.env, userConfig, cwd),
        });
        break;
      }

      case "": {
        const tours = await listTours(tourStoreRoot, {
          status: "all",
          worktreeStamp,
        }).catch(() => []);
        if (tours.length === 0) {
          console.log(firstRunBanner(tourStoreRoot, configPath));
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
        const editor = resolveEditor(flag(flags, "editor"), process.env, userConfig, cwd);
        const replyAgent = resolveReplyAgentTemplate(
          flag(flags, "reply-agent"),
          userConfig.replyAgent,
          configPath,
        );
        if (surface === "webapp") {
          await serve({
            port: defaultPreferredPort(),
            portExplicit: false,
            open: false,
            cwd,
            tourStoreRoot,
            worktreeStamp,
            ...replyAgent,
            configPath,
            editor,
          });
        } else {
          await tui({
            cwd,
            tourStoreRoot,
            worktreeStamp,
            ...replyAgent,
            configPath,
            editor,
          });
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
    } else if (isNotGitWorkingTreeError(err)) {
      console.error(message);
    } else {
      console.error(`Error: ${message}`);
    }
    process.exitCode = 1;
  }
}

main();
