import { listReviews, getReview, resolveIdPrefix } from "../core/review-store.js";
import { readAnnotations } from "../core/annotations-store.js";
import { getDiff, isShaResolvable } from "../core/git.js";
import { parseDiff } from "../core/diff-model.js";
import { html } from "./spa.js";

interface ServeArgs {
  port: number;
  open: boolean;
  reviewId?: string;
  cwd: string;
}

export async function startServer(args: ServeArgs): Promise<void> {
  const { port, cwd } = args;

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

          return Response.json({
            ...review,
            annotations,
            diff,
            diffModel,
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
    process.on("SIGINT", () => {
      server.stop();
      resolve();
    });
    process.on("SIGTERM", () => {
      server.stop();
      resolve();
    });
  });
}
