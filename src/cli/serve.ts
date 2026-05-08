interface ServeArgs {
  port: number;
  open: boolean;
  tourId?: string;
  cwd: string;
}

export async function serve(args: ServeArgs): Promise<void> {
  const serverModule = "../web/server.js";
  const { startServer } = await import(/* @vite-ignore */ serverModule) as {
    startServer: (args: ServeArgs) => Promise<void>;
  };
  await startServer(args);
}
