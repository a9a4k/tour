import { listReviews, getReview, resolveIdPrefix } from "../core/review-store.js";
import { readAnnotations } from "../core/annotations-store.js";
import { getDiff, isShaResolvable } from "../core/git.js";
import { parseDiff } from "../core/diff-model.js";
import { classifyFile } from "../core/file-classifier.js";
import { ReviewWatcher } from "../core/watcher.js";
import { html } from "./spa.js";

interface ServeArgs {
  port: number;
  open: boolean;
  reviewId?: string;
  cwd: string;
}

export async function startServer(args: ServeArgs): Promise<void> {
  const { port, cwd } = args;
  const watchers = new Map<string, ReviewWatcher>();

  function getOrCreateWatcher(reviewId: string): ReviewWatcher {
    let w = watchers.get(reviewId);
    if (!w) {
      w = new ReviewWatcher(cwd, reviewId);
      w.start();
      watchers.set(reviewId, w);
    }
    return w;
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/api/reviews") {
        const status = (url.searchParams.get("status") as "open" | "closed" | "all") ?? "open";
        const reviews = await listReviews(cwd, { status });
        return Response.json(reviews);
      }

      const eventsMatch = url.pathname.match(/^\/api\/reviews\/([^/]+)\/events$/);
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
                  controller.enqueue(`data: ${JSON.stringify({ type: "annotation-changed", reviewId: resolvedId })}\n\n`);
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

      if (url.pathname.startsWith("/api/reviews/")) {
        const idOrPrefix = url.pathname.split("/")[3];
        try {
          const resolvedId = await resolveIdPrefix(cwd, idOrPrefix);
          const review = await getReview(cwd, resolvedId);
          const annotations = await readAnnotations(cwd, resolvedId);

          const headOk = await isShaResolvable(review.head_sha, cwd);
          const baseOk = await isShaResolvable(review.base_sha, cwd);
          const snapshotLost = !headOk || !baseOk;

          let diff = "";
          let diffModel = { files: [] as ReturnType<typeof parseDiff>["files"] };
          if (!snapshotLost) {
            diff = await getDiff(review.base_sha, review.head_sha, cwd);
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
            ...review,
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

      return new Response(html(args.reviewId), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
  });

  const url = `http://127.0.0.1:${server.port}`;
  console.log(`Review server running at ${url}`);

  if (args.open) {
    const open = (await import("node:child_process")).exec;
    const cmd = process.platform === "darwin" ? "open" : "xdg-open";
    open(`${cmd} ${url}`);
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
