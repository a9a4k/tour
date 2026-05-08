import { listTours, getTour, resolveIdPrefix } from "../core/tour-store.js";
import { readAnnotations } from "../core/annotations-store.js";
import { getDiff, isShaResolvable } from "../core/git.js";
import { parseDiff } from "../core/diff-model.js";
import { classifyFile } from "../core/file-classifier.js";
import { TourWatcher } from "../core/watcher.js";
import { html } from "./spa.js";
import { highlightDiffLines } from "./highlight.js";

interface ServeArgs {
  port: number;
  open: boolean;
  tourId?: string;
  cwd: string;
}

export async function startServer(args: ServeArgs): Promise<void> {
  const { port, cwd } = args;
  const watchers = new Map<string, TourWatcher>();

  function getOrCreateWatcher(tourId: string): TourWatcher {
    let w = watchers.get(tourId);
    if (!w) {
      w = new TourWatcher(cwd, tourId);
      w.start();
      watchers.set(tourId, w);
    }
    return w;
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(req) {
      const url = new URL(req.url);

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
              const callback = () => {
                try {
                  controller.enqueue(`data: ${JSON.stringify({ type: "annotation-changed", tourId: resolvedId })}\n\n`);
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
          let highlightedLines: (string | null)[] = [];
          let diffModel = { files: [] as ReturnType<typeof parseDiff>["files"] };
          if (!snapshotLost) {
            diff = await getDiff(tour.base_sha, tour.head_sha, cwd);
            diffModel = parseDiff(diff);
            highlightedLines = highlightDiffLines(diff);
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
            highlightedLines,
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
      server.stop();
      resolve();
    }
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  });
}
