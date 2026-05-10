import { assertAdapterExists } from "../core/agent-adapter.js";

interface ServeArgs {
  port: number;
  open: boolean;
  tourId?: string;
  cwd: string;
  replyAgent?: string;
}

export async function serve(args: ServeArgs): Promise<void> {
  if (args.replyAgent) {
    assertAdapterExists(args.replyAgent);
  }
  const serverModule = "../web/server.js";
  const { startServer } = await import(/* @vite-ignore */ serverModule) as {
    startServer: (args: ServeArgs) => Promise<void>;
  };
  await startServer(args);
}
