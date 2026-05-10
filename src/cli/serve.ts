import { assertShippedAgent } from "../agents/index.js";

interface ServeArgs {
  port: number;
  open: boolean;
  tourId?: string;
  cwd: string;
  replyAgent?: string;
}

export async function serve(args: ServeArgs): Promise<void> {
  // Hard-fail at startup if the requested reply-agent isn't shipped, with
  // the list of available names — misconfiguration must surface up-front,
  // not at first reply (PRD #73, ADR 0012).
  if (args.replyAgent) {
    assertShippedAgent(args.replyAgent);
  }
  const serverModule = "../web/server.js";
  const { startServer } = await import(/* @vite-ignore */ serverModule) as {
    startServer: (args: ServeArgs) => Promise<void>;
  };
  await startServer(args);
}
