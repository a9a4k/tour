import { listTours, resolveIdPrefix } from "../core/tour-store.js";
import {
  createAnnotation,
  createReply,
} from "../core/annotations-store.js";
import { TourWatcher } from "../core/watcher.js";
import { readReplyLock } from "../core/reply-lock.js";
import { ReplyRunner } from "../core/reply-runner.js";
import { loadTourBundle } from "../core/tour-bundle.js";
import { html } from "./spa.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

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
    naming?: { entry?: string; chunk?: string; asset?: string } | string;
  }) => Promise<{
    success: boolean;
    logs: unknown[];
    outputs: BunBuildOutput[];
  }>;
};

interface BunBuildOutput {
  path: string;
  kind: "entry-point" | "chunk" | "asset" | "sourcemap" | "bytecode";
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

interface ClientAsset {
  body: string | ArrayBuffer;
  contentType: string;
}

let cachedClientAssets: Map<string, ClientAsset> | null = null;
let cachedClientBundleError: string | null = null;

const DEFAULT_HUMAN_AUTHOR = "you";

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asInt(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isInteger(v)) return undefined;
  return v;
}

// Single-pass build of the client + any worker chunks Pierre emits via
// `new Worker(new URL(..., import.meta.url))`. Each output is keyed by its
// public URL path so the request handler can serve any auxiliary chunks
// (worker, asset) the browser asks for. The entry-point output is also
// aliased at `/client.js` so the HTML loader doesn't need to know its
// bundler-assigned hash.
async function getClientAssets(): Promise<{ assets: Map<string, ClientAsset> | null; error: string | null }> {
  if (cachedClientAssets !== null) return { assets: cachedClientAssets, error: null };
  if (cachedClientBundleError !== null) return { assets: null, error: cachedClientBundleError };
  const here = dirname(fileURLToPath(import.meta.url));
  const clientEntry = resolve(here, "client/main.tsx");
  // Pierre's worker entry is bundled as a SECOND entrypoint so it becomes
  // its own file. Bun.build doesn't rewrite `new Worker(new URL(...,
  // import.meta.url))` the way Vite/webpack do, so we keep the worker URL
  // explicit on the client side (main.tsx → "/pierre-worker.js").
  //
  // Resolution prefers ESM-aware `import.meta.resolve` so the package's
  // `exports."./worker/worker.js"` map is honoured. createRequire's
  // CommonJS resolver doesn't read the exports map for sub-path imports
  // in this package layout — it fails with "Cannot find module".
  const workerSpecifier = "@pierre/diffs/worker/worker.js";
  const workerEntry = resolveBareSpecifier(workerSpecifier);
  try {
    const result = await Bun.build({
      entrypoints: [clientEntry, workerEntry],
      target: "browser",
      minify: false,
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      sourcemap: "none",
      // Stable, hash-free names so main.tsx can reference "/pierre-worker.js"
      // and spa.ts can reference "/client.js" — the entry naming uses
      // [name] which we pin per-entry below via output reconciliation.
      naming: {
        entry: "[name].js",
        chunk: "chunk-[hash].js",
        asset: "[name]-[hash].[ext]",
      },
    });
    if (!result.success) {
      cachedClientBundleError = `client bundle failed: ${JSON.stringify(result.logs)}`;
      return { assets: null, error: cachedClientBundleError };
    }
    const assets = new Map<string, ClientAsset>();
    let clientArtifact: BunBuildOutput | null = null;
    let workerArtifact: BunBuildOutput | null = null;
    for (const out of result.outputs) {
      const publicPath = "/" + out.path.replace(/^\.\//, "").replace(/^\//, "");
      const contentType = contentTypeFor(out.path);
      const body = contentType.startsWith("text/") || contentType.includes("javascript") || contentType.includes("json")
        ? await out.text()
        : await out.arrayBuffer();
      assets.set(publicPath, { body, contentType });
      if (out.kind !== "entry-point") continue;
      // Two entry-points (client + worker). Bun names them after their
      // source file basenames — match by path suffix so worktree shuffles
      // don't break the assignment.
      if (out.path.endsWith("/main.js") || out.path === "main.js") clientArtifact = out;
      else if (out.path.endsWith("/worker.js") || out.path === "worker.js") workerArtifact = out;
    }
    if (clientArtifact !== null) {
      const text = await clientArtifact.text();
      assets.set("/client.js", { body: text, contentType: "application/javascript; charset=utf-8" });
    }
    if (workerArtifact !== null) {
      const text = await workerArtifact.text();
      assets.set("/pierre-worker.js", { body: text, contentType: "application/javascript; charset=utf-8" });
    }
    cachedClientAssets = assets;
    return { assets, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    cachedClientBundleError = `client bundle threw: ${message}`;
    return { assets: null, error: cachedClientBundleError };
  }
}

function resolveBareSpecifier(specifier: string): string {
  // Bun's `import.meta.resolve` honours ESM `exports` maps (which CJS
  // `createRequire.resolve` does not for sub-paths). The method requires
  // a bound `this` — extracting it as a local function reference throws
  // "must be bound to an import.meta object" — so call it via the
  // member expression. Falls back to CJS resolution if unavailable.
  const meta = import.meta as ImportMeta & { resolve?: (s: string) => string };
  if (typeof meta.resolve === "function") {
    try {
      const out = meta.resolve(specifier);
      return out.startsWith("file:") ? fileURLToPath(out) : out;
    } catch {
      // fall through to CJS resolver
    }
  }
  return createRequire(import.meta.url).resolve(specifier);
}

function contentTypeFor(path: string): string {
  if (path.endsWith(".js") || path.endsWith(".mjs")) return "application/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".wasm")) return "application/wasm";
  if (path.endsWith(".map")) return "application/json; charset=utf-8";
  return "application/octet-stream";
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

      // Serve any client-bundle output — entry, worker chunks, assets —
      // from a single map. The entry is aliased at /client.js (spa.ts);
      // worker chunks land at their hashed paths because Bun rewrites
      // `new Worker(new URL(...))` URLs to those names.
      if (url.pathname === "/client.js" || /^\/[^/]+\.(js|css|wasm|map|json)$/.test(url.pathname)) {
        const { assets, error } = await getClientAssets();
        if (assets === null) {
          return new Response(`/* ${error} */`, {
            status: 500,
            headers: { "Content-Type": "application/javascript" },
          });
        }
        const asset = assets.get(url.pathname);
        if (asset !== undefined) {
          return new Response(asset.body, {
            headers: {
              "Content-Type": asset.contentType,
              "Cache-Control": "no-cache",
            },
          });
        }
        if (url.pathname === "/client.js") {
          return new Response("/* entry-point not emitted */", {
            status: 500,
            headers: { "Content-Type": "application/javascript" },
          });
        }
        // Fall through for unmatched paths — let the SPA HTML handle them.
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
          const text = asString(body.body);
          // HTTP-shape concern only — whitespace-only rejection lives in
          // the Annotation creation seam (PRD #140 rule 1/5).
          if (text === undefined) throw new Error("body is required");
          const author = asString(body.author) ?? DEFAULT_HUMAN_AUTHOR;
          const repliesTo = asString(body.replies_to);
          if (repliesTo) {
            const reply = await createReply(cwd, resolvedId, {
              replies_to: repliesTo,
              body: text,
              author,
              author_kind: "human",
            });
            return Response.json(reply, { status: 201 });
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
          const ann = await createAnnotation(cwd, resolvedId, {
            file,
            side,
            line_start: start,
            line_end: end,
            body: text,
            author,
            author_kind: "human",
          });
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
