import { assertShippedAgent } from "../agents/index.js";
import type { EditorConfig } from "../core/editor-config.js";

interface ServeArgs {
  port: number;
  portExplicit: boolean;
  open: boolean;
  tourId?: string;
  cwd: string;
  tourStoreRoot?: string;
  worktreeStamp?: string;
  replyAgent?: string;
  replyAgentSourcePath?: string;
  configPath: string;
  // PRD #349 / ADR 0032 / issue #353: resolved EditorConfig from
  // main.ts (--editor → $TOUR_EDITOR → $VISUAL → $EDITOR → null).
  // Threads through to the POST /api/tours/<id>/open-in-editor handler.
  editor?: EditorConfig | null;
}

export async function serve(args: ServeArgs): Promise<void> {
  // Hard-fail at startup if the requested reply-agent isn't shipped, with
  // the list of available names — misconfiguration must surface up-front,
  // not at first reply (PRD #73, ADR 0012).
  if (args.replyAgent) {
    assertShippedAgent(args.replyAgent, args.replyAgentSourcePath);
  }
  // Static-string specifier so Bun --compile embeds the web module; cast hides
  // the path from tsc since src/web is excluded (JSX).
  const { startServer } = (await import("../web/server.js" as string)) as {
    startServer: (args: ServeArgs) => Promise<void>;
  };
  await startServer(args);
}
