import { listTours, resolveIdPrefix } from "../core/tour-store.js";
import {
  readAnnotations,
  appendAnnotation,
  buildAnnotation,
  buildReply,
} from "../core/annotations-store.js";
import { TourWatcher } from "../core/watcher.js";
import { readReplyLock } from "../core/reply-lock.js";
import { ReplyRunner } from "../core/reply-runner.js";
import { loadTourBundle } from "../core/tour-bundle.js";
import { html } from "./spa.js";
import type { Annotation } from "../core/types.js";
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

const DEFAULT_HUMAN_AUTHOR = "you";

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asInt(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isInteger(v)) return undefined;
  return v;
}

/**
 * Build a human-authored Annotation from a webapp POST body. Mirrors the
 * `tour annotate --as-human [--reply-to]` CLI surface (PRD #73 / Slice 3
 * #77). Throws on missing / malformed fields so the route returns 400.
 *
 * Exported for unit tests; the route handler does the disk write.
 */
export async function createHumanAnnotation(
  cwd: string,
  tourId: string,
  body: Record<string, unknown>,
): Promise<Annotation> {
  const text = asString(body.body);
  if (!text || text.trim().length === 0) {
    throw new Error("body is required");
  }
  const author = asString(body.author) ?? DEFAULT_HUMAN_AUTHOR;
  const repliesTo = asString(body.replies_to);
  if (repliesTo) {
    const existing = await readAnnotations(cwd, tourId);
    return buildReply(
      { replies_to: repliesTo, body: text, author, author_kind: "human" },
      existing,
    );
  }
  const file = asString(body.file);
  if (!file) throw new Error("file is required");
  const side = body.side === "additions" || body.side === "deletions" ? body.side : null;
  if (side === null) throw new Error("side must be \"additions\" or \"deletions\"");
  const start = asInt(body.line_start);
  const end = asInt(body.line_end);
  if (start === undefined) throw new Error("line_start is required");
  if (end === undefined) throw new Error("line_end is required");
  if (end < start) throw new Error("line_end must be >= line_start");
  return buildAnnotation({
    file,
    side,
    line_start: start,
    line_end: end,
    body: text,
    author,
    author_kind: "human",
  });
}

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

      const annotateMatch = url.pathname.match(/^\/api\/tours\/([^/]+)\/annotations$/);
      if (annotateMatch && req.method === "POST") {
        const idOrPrefix = annotateMatch[1];
        try {
          const resolvedId = await resolveIdPrefix(cwd, idOrPrefix);
          const body = (await req.json()) as Record<string, unknown>;
          const ann = await createHumanAnnotation(cwd, resolvedId, body);
          await appendAnnotation(cwd, resolvedId, ann);
          return Response.json(ann, { status: 201 });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ error: message }, { status: 400 });
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
          const bundle = await loadTourBundle(cwd, resolvedId);
          return Response.json(bundle);
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
