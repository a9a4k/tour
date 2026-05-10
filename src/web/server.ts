import { listTours, getTour, resolveIdPrefix } from "../core/tour-store.js";
import { readAnnotations } from "../core/annotations-store.js";
import { getDiff, isShaResolvable } from "../core/git.js";
import { parseDiff } from "../core/diff-model.js";
import { classifyFile } from "../core/file-classifier.js";
import { TourWatcher } from "../core/watcher.js";
import { readReplyLock } from "../core/reply-lock.js";
import { ReplyRunner } from "../core/reply-runner.js";
import { assertAdapterExists } from "../core/agent-adapter.js";
import { html } from "./spa.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

interface ServeArgs {
  port: number;
  open: boolean;
  tourId?: string;
  cwd: string;
  replyAgent?: string;
}

declare const Bun: {
  serve: (opts: {
    hostname: string;
    port: number;
    fetch: (req: Request) => Response | Promise<Response>;
  }) => { port: number; stop: () => void };
  build: (opts: {
    entrypoints: string[];
    target?: "browser" | "bun" | "node";
    minify?: boolean;
    define?: Record<string, string>;
    sourcemap?: "none" | "inline" | "external" | "linked";
  }) => Promise<{
    success: boolean;
    logs: unknown[];
    outputs: { text: () => Promise<string> }[];
  }>;
};

let cachedClientBundle: string | null = null;
let cachedClientBundleError: string | null = null;

async function getClientBundle(): Promise<{ js: string | null; error: string | null }> {
  if (cachedClientBundle !== null) return { js: cachedClientBundle, error: null };
  if (cachedClientBundleError !== null) return { js: null, error: cachedClientBundleError };
  const here = dirname(fileURLToPath(import.meta.url));
  const entry = resolve(here, "client/main.tsx");
  try {
    const result = await Bun.build({
      entrypoints: [entry],
      target: "browser",
      minify: false,
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      sourcemap: "none",
    });
    if (!result.success) {
      cachedClientBundleError = `client bundle failed: ${JSON.stringify(result.logs)}`;
      return { js: null, error: cachedClientBundleError };
    }
    cachedClientBundle = await result.outputs[0].text();
    return { js: cachedClientBundle, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    cachedClientBundleError = `client bundle threw: ${message}`;
    return { js: null, error: cachedClientBundleError };
  }
}

export async function startServer(args: ServeArgs): Promise<void> {
  const { port, cwd, replyAgent } = args;
  const watchers = new Map<string, TourWatcher>();
  const runners = new Map<string, ReplyRunner>();

  function getOrCreateWatcher(tourId: string): TourWatcher {
    let w = watchers.get(tourId);
    if (!w) {
      w = new TourWatcher(cwd, tourId);
      w.start();
      watchers.set(tourId, w);

      // If a reply-agent is configured, dispatch on annotation-changed.
      // The runner is per-tour (single-flight per tour) and seeded from
      // existing annotations so pre-existing human notes don't fire.
      if (replyAgent) {
        const runner = new ReplyRunner({ cwd, tourId, agent: replyAgent });
        runners.set(tourId, runner);
        void runner.prime();
        w.on((event) => {
          if (event.type === "annotation-changed") {
            void runner.tick().catch(() => {
              // swallow — a transient read failure should not crash serve
            });
          }
        });
      }
    }
    return w;
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/client.js") {
        const { js, error } = await getClientBundle();
        if (js === null) {
          return new Response(`/* ${error} */`, {
            status: 500,
            headers: { "Content-Type": "application/javascript" },
          });
        }
        return new Response(js, {
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "no-cache",
          },
        });
      }

      if (url.pathname === "/api/tours") {
        const status = (url.searchParams.get("status") as "open" | "closed" | "all") ?? "open";
        const tours = await listTours(cwd, { status });
        return Response.json(tours);
      }

      const eventsMatch = url.pathname.match(/^\/api\/tours\/([^/]+)\/events$/);
      if (eventsMatch) {
        const idOrPrefix = eventsMatch[1];
        try {
          const resolvedId = await resolveIdPrefix(cwd, idOrPrefix);
          const watcher = getOrCreateWatcher(resolvedId);
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue("data: {\"type\":\"connected\"}\n\n");
              const callback = (event: import("../core/watcher.js").WatchEvent) => {
                try {
                  controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
                } catch {
                  watcher.off(callback);
                }
              };
              watcher.on(callback);
              req.signal.addEventListener("abort", () => {
                watcher.off(callback);
              });
            },
          });
          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              "Connection": "keep-alive",
            },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ error: message }, { status: 404 });
        }
      }

      const lockMatch = url.pathname.match(/^\/api\/tours\/([^/]+)\/reply-lock$/);
      if (lockMatch) {
        const idOrPrefix = lockMatch[1];
        try {
          const resolvedId = await resolveIdPrefix(cwd, idOrPrefix);
          const lock = await readReplyLock(cwd, resolvedId);
          return Response.json(lock);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ error: message }, { status: 404 });
        }
      }

      const tourMatch = url.pathname.match(/^\/api\/tours\/([^/]+)$/);
      if (tourMatch) {
        const idOrPrefix = tourMatch[1];
        try {
          const resolvedId = await resolveIdPrefix(cwd, idOrPrefix);
          const tour = await getTour(cwd, resolvedId);
          const annotations = await readAnnotations(cwd, resolvedId);

          const headOk = await isShaResolvable(tour.head_sha, cwd);
          const baseOk = await isShaResolvable(tour.base_sha, cwd);
          const snapshotLost = !headOk || !baseOk;

          let diff = "";
          let diffModel = { files: [] as ReturnType<typeof parseDiff>["files"] };
          if (!snapshotLost) {
            diff = await getDiff(tour.base_sha, tour.head_sha, cwd);
            diffModel = parseDiff(diff);
          }

          const classifications = await Promise.all(
            diffModel.files.map(async (f) => {
              const isRenamed = f.type === "rename" || (!!f.prevName && f.prevName !== f.name);
              const hasChanges = f.hunks.length > 0;
              const isBinary = f.type === "binary";
              const classification = await classifyFile(f.name, { cwd, isBinary, isRenamed, hasChanges });
              return { file: f.name, classification };
            }),
          );
          const classificationMap = Object.fromEntries(
            classifications.map((c) => [c.file, c.classification]),
          );

          return Response.json({
            ...tour,
            annotations,
            diff,
            diffModel: {
              files: diffModel.files.map((f) => ({
                ...f,
                classification: classificationMap[f.name] ?? { collapsed: false },
              })),
            },
            snapshotLost,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ error: message }, { status: 404 });
        }
      }

      return new Response(html(args.tourId), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
  });

  const url = `http://127.0.0.1:${server.port}`;
  console.log(`Tour server running at ${url}`);

  if (args.open) {
    const { execFile: openExec } = await import("node:child_process");
    const cmd = process.platform === "darwin" ? "open" : "xdg-open";
    openExec(cmd, [url]);
  }

  await new Promise<void>((resolve) => {
    function cleanup() {
      for (const w of watchers.values()) w.stop();
      watchers.clear();
      runners.clear();
      server.stop();
      resolve();
    }
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  });
}
