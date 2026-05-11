import { listTours, resolveIdPrefix } from "../core/tour-store.js";
import {
  createAnnotation,
  createReply,
} from "../core/annotations-store.js";
import { TourWatcher } from "../core/watcher.js";
import { readReplyLock } from "../core/reply-lock.js";
import { ReplyRunner } from "../core/reply-runner.js";
import { loadTourBundle } from "../core/tour-bundle.js";
import { detectAgentsOnPath } from "../core/agent-path-detector.js";
import { isOnPath } from "../core/is-on-path.js";
import { probeTour } from "../core/tour-probe.js";
import { availableShippedAgents } from "../agents/index.js";
import { html } from "./spa.js";
import { EMBEDDED_CLIENT_JS, EMBEDDED_PIERRE_WORKER_JS } from "./embedded-client.js";
import { bindWithFallback } from "./bind-with-fallback.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

interface ServeArgs {
  port: number;
  portExplicit: boolean;
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

  // Compiled-binary fast path. Bun.build can't run inside /$bunfs/ — it has
  // no real directory listings, so any entrypoint path errors with
  // "FileNotFound: failed to open root directory". scripts/build-client.ts
  // bakes the bundle strings into embedded-client.ts at binary-build time;
  // when the constants are populated, use them and skip Bun.build entirely.
  if (EMBEDDED_CLIENT_JS && EMBEDDED_PIERRE_WORKER_JS) {
    const assets = new Map<string, ClientAsset>();
    const ct = "application/javascript; charset=utf-8";
    assets.set("/client.js", { body: EMBEDDED_CLIENT_JS, contentType: ct });
    assets.set("/pierre-worker.js", { body: EMBEDDED_PIERRE_WORKER_JS, contentType: ct });
    cachedClientAssets = assets;
    return { assets, error: null };
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const clientEntry = resolve(here, "client/main.tsx");
  // Bun.build doesn't rewrite `new Worker(new URL(..., import.meta.url))`
  // across npm packages, so main.tsx references a stable "/pierre-worker.js"
  // URL and we bundle the worker as a second entry. Resolve directly through
  // the package exports map — @pierre/diffs marks only its web-components
  // file as a side effect, so bundling via a bare-specifier shim file gets
  // tree-shaken to 0 bytes. (This path runs only in dev: the compiled
  // binary takes the embedded fast-path above. import.meta.resolve works
  // here because we're outside /$bunfs/.)
  const workerEntry = fileURLToPath(import.meta.resolve("@pierre/diffs/worker/worker.js"));
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
      // source file basenames — main.tsx → main.js, the @pierre/diffs
      // worker module → worker.js. Match by basename so worktree shuffles
      // don't break the assignment.
      const base = out.path.split("/").pop() ?? out.path;
      if (base === "main.js") clientArtifact = out;
      else if (base === "worker.js") workerArtifact = out;
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

function contentTypeFor(path: string): string {
  if (path.endsWith(".js") || path.endsWith(".mjs")) return "application/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".wasm")) return "application/wasm";
  if (path.endsWith(".map")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

export async function startServer(args: ServeArgs): Promise<void> {
  const { port, portExplicit, cwd, replyAgent } = args;

  // Reuse-if-running (issue #178). Probe the preferred port: if a Tour
  // server is already serving this cwd, log the existing URL and exit
  // without starting a second server. Different-cwd Tour, non-Tour, or
  // free port → fall through to the existing bind path.
  const existing = await probeTour(port, fetch, 150);
  if (existing.kind === "tour" && existing.cwd === cwd) {
    console.log(`Tour already running at http://127.0.0.1:${port}`);
    return;
  }

  const startedAt = new Date().toISOString();
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

  const { resource: server, boundPort, preferredWasBusy } = await bindWithFallback(
    port,
    portExplicit,
    (tryPort) => Bun.serve({
      hostname: "127.0.0.1",
      port: tryPort,
      async fetch(req) {
        const url = new URL(req.url);

        // Identity probe (issue #178). Lets a second `tour serve` recognise
        // an already-running Tour for the same cwd and reuse it instead of
        // spawning a duplicate server. Unauthenticated, cheap, tourId-agnostic.
        if (url.pathname === "/__alive") {
          return Response.json({
            tour: true,
            cwd,
            port: tryPort,
            startedAt,
          });
        }

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
            const author = asString(body.author);
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
            // The seam owns line-range + file-membership validation (PRD #140
            // / slice 4 #144) — load the bundle so it has something to check
            // against. Cost is one extra read per POST; SPA already pays this
            // on its own `GET /api/tours/:id` calls.
            const bundle = await loadTourBundle(cwd, resolvedId);
            const ann = await createAnnotation(
              cwd,
              resolvedId,
              {
                file,
                side,
                line_start: start,
                line_end: end,
                body: text,
                author,
                author_kind: "human",
              },
              bundle,
            );
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
    }),
  );

  const url = `http://127.0.0.1:${boundPort}`;
  if (preferredWasBusy) {
    console.log(`Tour server: port ${port} busy, listening on ${url}`);
  } else {
    console.log(`Tour server running at ${url}`);
  }

  // Reply-agent discovery tip (issue #174). Emit a single one-line
  // suggestion when no --reply-agent was passed and exactly one shipped
  // agent CLI is reachable on PATH. Zero or many matches → silent (no
  // actionable suggestion). Inert by default — never auto-enables (ADR 0010).
  if (replyAgent === undefined) {
    const found = detectAgentsOnPath(availableShippedAgents(), isOnPath);
    if (found.length === 1) {
      console.log(
        `Tip: detected '${found[0]}' on PATH. Run with --reply-agent ${found[0]} to enable agent replies.`,
      );
    }
  }

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
