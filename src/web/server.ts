import { listTours, resolveIdPrefix } from "../core/tour-store.js";
import { pickAutoTour } from "../core/tour-list.js";
import {
  createComment,
  createDelete,
  createReply,
} from "../core/comments-store.js";
import { TourWatcher, type WatchCallback } from "../core/watcher.js";
import { readReplyLock } from "../core/reply-lock.js";
import {
  requestReply,
  httpStatusForRequestReplyResult,
} from "../core/reply-runner.js";
import { loadTourBundle } from "../core/tour-bundle.js";
import { detectAgentsOnPath } from "../core/agent-path-detector.js";
import { isOnPath } from "../core/is-on-path.js";
import { availableShippedAgents } from "../agents/index.js";
import { spawnGuiEditor } from "../core/editor-spawn.js";
import { editorNotConfiguredMessage } from "../core/config-discoverability.js";
import type { EditorConfig } from "../core/editor-config.js";
import { html } from "./spa.js";
import {
  EMBEDDED_BUILD_MODE,
  EMBEDDED_CLIENT_JS,
  resolveEmbedded,
} from "./embedded-client.js";
import {
  createClientAssetsCache,
  type AssetsResult,
  type ClientAsset,
} from "./client-assets.js";
import { resolveServePort } from "./resolve-serve-port.js";
import { resolve, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";

interface ServeArgs {
  port: number;
  portExplicit: boolean;
  open: boolean;
  tourId?: string;
  cwd: string;
  tourStoreRoot?: string;
  worktreeStamp?: string;
  replyAgent?: string;
  configPath: string;
  // PRD #349 / ADR 0032 / issue #353: resolved EditorConfig from
  // main.ts. Powers the POST /api/tours/<id>/open-in-editor handler;
  // null when no editor was configured (the handler returns 412).
  editor?: EditorConfig | null;
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

const SSE_HEARTBEAT_MS = 5_000;

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asInt(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isInteger(v)) return undefined;
  return v;
}

// Single-pass build of the webapp client + any chunks Bun emits. Each
// output is keyed by its public URL path so the request handler can
// serve any auxiliary chunks (asset) the browser asks for. The entry-
// point output is also aliased at `/client.js` so the HTML loader doesn't
// need to know its bundler-assigned hash. Bun.build can't run inside
// /$bunfs/ — the compiled binary takes the embedded fast-path in
// client-assets.ts.
//
// Post-PRD #212 cutover, the renderer is Tour-owned and synthesises
// syntax highlighting on the main thread via Shiki — no worker entry-
// point is bundled anymore.
async function buildClientFromSource(): Promise<AssetsResult> {
  const here = dirname(fileURLToPath(import.meta.url));
  const clientEntry = resolve(here, "client/main.tsx");
  try {
    const result = await Bun.build({
      entrypoints: [clientEntry],
      target: "browser",
      minify: false,
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      sourcemap: "none",
      naming: {
        entry: "[name].js",
        chunk: "chunk-[hash].js",
        asset: "[name]-[hash].[ext]",
      },
    });
    if (!result.success) {
      return { assets: null, error: `client bundle failed: ${JSON.stringify(result.logs)}` };
    }
    const assets = new Map<string, ClientAsset>();
    let clientArtifact: BunBuildOutput | null = null;
    for (const out of result.outputs) {
      const publicPath = "/" + out.path.replace(/^\.\//, "").replace(/^\//, "");
      const contentType = contentTypeFor(out.path);
      const body = contentType.startsWith("text/") || contentType.includes("javascript") || contentType.includes("json")
        ? await out.text()
        : await out.arrayBuffer();
      assets.set(publicPath, { body, contentType });
      if (out.kind !== "entry-point") continue;
      const base = out.path.split("/").pop() ?? out.path;
      if (base === "main.js") clientArtifact = out;
    }
    if (clientArtifact !== null) {
      const text = await clientArtifact.text();
      assets.set("/client.js", { body: text, contentType: "application/javascript; charset=utf-8" });
    }
    return { assets, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { assets: null, error: `client bundle threw: ${message}` };
  }
}

// Per-process cache. Compiled-binary path is sticky (embedded constants
// are immutable for the life of the process); dev mode rebuilds on every
// call so source edits + `bun scripts/build-client.ts` reach the next
// request without restarting `tour serve` (issue #202). The dev-vs-binary
// discriminator is the explicit `EMBEDDED_BUILD_MODE` marker — the
// bundle strings' truthiness is not part of the check, so an interrupted
// binary build that left them populated but the marker "dev" still falls
// through to the runtime Bun.build path (issue #204).
const getClientAssets = createClientAssetsCache({
  getEmbedded: () => resolveEmbedded(EMBEDDED_BUILD_MODE, EMBEDDED_CLIENT_JS),
  buildFromSource: buildClientFromSource,
});

function contentTypeFor(path: string): string {
  if (path.endsWith(".js") || path.endsWith(".mjs")) return "application/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".wasm")) return "application/wasm";
  if (path.endsWith(".map")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

export async function startServer(args: ServeArgs): Promise<void> {
  const { port, portExplicit, cwd, replyAgent, configPath } = args;
  const tourStoreRoot = args.tourStoreRoot ?? cwd;
  const editor = args.editor ?? null;

  // Path component appended to printed URLs (issue #179). Lets the user
  // Cmd-click straight to their tour in a modern terminal. The SPA reads
  // tour-id from the path with higher precedence than the baked
  // `__INITIAL_TOUR_ID__`, so the printed URL wins over whatever id the
  // running server's HTML carries — load-bearing for the probe-reuse case
  // where the server was started for a different tour.
  //
  // Explicit positional id always wins. When omitted (issue #187), pre-pick
  // the same tour the SPA's auto-select would land on — most-recent open —
  // so the terminal URL routes to a real tour instead of bare `/`. Zero
  // open tours → bare URL, unchanged from today.
  const effectiveTourId =
    args.tourId ??
    (pickAutoTour(await listTours(tourStoreRoot, {
      status: "all",
      worktreeStamp: args.worktreeStamp,
    })))?.id;
  const path = effectiveTourId ? `/${effectiveTourId}` : "";

  const startedAt = new Date().toISOString();
  const watchers = new Map<string, TourWatcher>();

  function getOrCreateWatcher(tourId: string): TourWatcher {
    let w = watchers.get(tourId);
    if (!w) {
      w = new TourWatcher(tourStoreRoot, tourId);
      w.start();
      watchers.set(tourId, w);
    }
    return w;
  }

  // Reuse-if-running (issues #178, #195). The walk probes EACH port
  // before deciding to reuse (same-cwd Tour), skip (other-cwd Tour or
  // non-Tour process), or bind. The previous slice-1.5 composition
  // probed only the preferred port, then handed off to a non-probing
  // bind walk — so a same-cwd Tour living on a fallback port was missed.
  const portResult = await resolveServePort({
    preferred: port,
    explicit: portExplicit,
    cwd,
    tryBind: (tryPort) => Bun.serve({
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
          const includeAll =
            url.searchParams.get("all") === "1" ||
            url.searchParams.get("all") === "true";
          const tours = await listTours(tourStoreRoot, {
            status,
            worktreeStamp: includeAll ? undefined : args.worktreeStamp,
          });
          return Response.json(tours);
        }

        const eventsMatch = url.pathname.match(/^\/api\/tours\/([^/]+)\/events$/);
        if (eventsMatch) {
          const idOrPrefix = eventsMatch[1];
          try {
            const resolvedId = await resolveIdPrefix(tourStoreRoot, idOrPrefix);
            const watcher = getOrCreateWatcher(resolvedId);
            const stream = new ReadableStream({
              start(controller) {
                let heartbeat: ReturnType<typeof setInterval> | null = null;
                let callback: WatchCallback | null = null;
                let cleanedUp = false;
                const cleanup = () => {
                  if (cleanedUp) return;
                  cleanedUp = true;
                  if (heartbeat !== null) clearInterval(heartbeat);
                  if (callback !== null) watcher.off(callback);
                  req.signal.removeEventListener("abort", cleanup);
                };
                const enqueue = (chunk: string): boolean => {
                  try {
                    controller.enqueue(chunk);
                    return true;
                  } catch {
                    cleanup();
                    return false;
                  }
                };

                if (!enqueue("data: {\"type\":\"connected\"}\n\n")) return;
                callback = (event: import("../core/watcher.js").WatchEvent) => {
                  enqueue(`data: ${JSON.stringify(event)}\n\n`);
                };
                watcher.on(callback);
                heartbeat = setInterval(() => {
                  enqueue(": keepalive\n\n");
                }, SSE_HEARTBEAT_MS);
                req.signal.addEventListener("abort", cleanup);
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

        const commentMatch = url.pathname.match(/^\/api\/tours\/([^/]+)\/comments$/);
        if (commentMatch && req.method === "POST") {
          const idOrPrefix = commentMatch[1];
          try {
            const resolvedId = await resolveIdPrefix(tourStoreRoot, idOrPrefix);
            const body = (await req.json()) as Record<string, unknown>;
            const text = asString(body.body);
            // HTTP-shape concern only — whitespace-only rejection lives in
            // the Comment creation seam (PRD #140 rule 1/5).
            if (text === undefined) throw new Error("body is required");
            const author = asString(body.author);
            const threadId = asString(body.thread_id);
            if (threadId) {
              const reply = await createReply(tourStoreRoot, resolvedId, {
                thread_id: threadId,
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
            const bundle = await loadTourBundle(tourStoreRoot, resolvedId, cwd);
            const ann = await createComment(
              tourStoreRoot,
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

        // Issue #389 / ADR 0036 (Slice E): webapp delete bridge. DELETE
        // `/api/tours/<id>/comments/<comment-id>` writes a humans-only
        // `comment.deleted` event via the shared `createDelete` seam — the
        // same path the CLI's `--delete` flag uses (Slice C). The webapp's
        // delete is implicitly human; agents have no surface here.
        const deleteCommentMatch = url.pathname.match(
          /^\/api\/tours\/([^/]+)\/comments\/([^/]+)$/,
        );
        if (deleteCommentMatch && req.method === "DELETE") {
          const idOrPrefix = deleteCommentMatch[1];
          const commentId = deleteCommentMatch[2];
          try {
            const resolvedId = await resolveIdPrefix(tourStoreRoot, idOrPrefix);
            const result = await createDelete(tourStoreRoot, resolvedId, {
              target_id: commentId,
              by_kind: "human",
            });
            return Response.json(result, { status: 200 });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return Response.json({ error: message }, { status: 400 });
          }
        }

        const requestReplyMatch = url.pathname.match(
          /^\/api\/tours\/([^/]+)\/request-reply$/,
        );
        if (requestReplyMatch && req.method === "POST") {
          const idOrPrefix = requestReplyMatch[1];
          let resolvedId: string;
          try {
            resolvedId = await resolveIdPrefix(tourStoreRoot, idOrPrefix);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return Response.json({ error: message }, { status: 404 });
          }
          const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
          const commentId = asString(body.comment_id);
          if (!commentId) {
            return Response.json(
              { error: "comment_id is required" },
              { status: 400 },
            );
          }
          const result = await requestReply({
            cwd,
            tourStoreRoot,
            tourId: resolvedId,
            commentId,
            agent: replyAgent,
          });
          return Response.json(result, {
            status: httpStatusForRequestReplyResult(result),
          });
        }

        // PRD #349 / ADR 0032 / issue #353: webapp parity for `o`. The
        // server spawns the configured GUI editor on the browser's behalf
        // via core/editor-spawn (shared with the TUI). Terminal-classified
        // editors are refused with 409 — the server has no terminal to
        // lend (physics, not policy). The tour-scoped path + the
        // file ∈ tour.diff.files check is the security boundary;
        // 127.0.0.1-only binding is the outer guard.
        const openInEditorMatch = url.pathname.match(
          /^\/api\/tours\/([^/]+)\/open-in-editor$/,
        );
        if (openInEditorMatch && req.method === "POST") {
          const idOrPrefix = openInEditorMatch[1];
          let resolvedId: string;
          try {
            resolvedId = await resolveIdPrefix(tourStoreRoot, idOrPrefix);
          } catch {
            return Response.json(
              { ok: false, message: "o: tour not found" },
              { status: 404 },
            );
          }
          const body = (await req.json().catch(() => null)) as
            | Record<string, unknown>
            | null;
          if (!body) {
            return Response.json(
              { ok: false, message: "o: invalid body" },
              { status: 400 },
            );
          }
          const file = asString(body.file);
          const line = asInt(body.line);
          if (file === undefined || line === undefined) {
            return Response.json(
              { ok: false, message: "o: invalid body" },
              { status: 400 },
            );
          }
          // `side` is carried for forward compatibility with a future
          // staleness-warning follow-up; not acted on in this slice.
          const bundle = await loadTourBundle(tourStoreRoot, resolvedId, cwd);
          if (bundle.kind !== "ok") {
            return Response.json(
              { ok: false, message: "o: tour snapshot lost" },
              { status: 404 },
            );
          }
          const inTour = bundle.files.some((f) => f.name === file);
          if (!inTour) {
            return Response.json(
              { ok: false, message: `o: ${file} not in tour diff` },
              { status: 400 },
            );
          }
          const absPath = isAbsolute(file) ? file : join(cwd, file);
          const present = await access(absPath).then(
            () => true,
            () => false,
          );
          if (!present) {
            return Response.json(
              { ok: false, message: `o: ${file} not in working tree` },
              { status: 404 },
            );
          }
          if (editor === null) {
            return Response.json(
              {
                ok: false,
                message: editorNotConfiguredMessage(configPath),
              },
              { status: 412 },
            );
          }
          if (editor.terminal) {
            return Response.json(
              {
                ok: false,
                message: "o: terminal editor — open from TUI instead",
              },
              { status: 409 },
            );
          }
          const result = await spawnGuiEditor(editor, { file, line }, cwd);
          return Response.json(result, { status: result.ok ? 200 : 500 });
        }

        const lockMatch = url.pathname.match(/^\/api\/tours\/([^/]+)\/reply-lock$/);
        if (lockMatch) {
          const idOrPrefix = lockMatch[1];
          try {
            const resolvedId = await resolveIdPrefix(tourStoreRoot, idOrPrefix);
            const lock = await readReplyLock(tourStoreRoot, resolvedId);
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
            const resolvedId = await resolveIdPrefix(tourStoreRoot, idOrPrefix);
            const bundle = await loadTourBundle(tourStoreRoot, resolvedId, cwd);
            return Response.json(bundle);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return Response.json({ error: message }, { status: 404 });
          }
        }

        return new Response(html(effectiveTourId, replyAgent, configPath), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      },
    }),
  });

  if (portResult.kind === "reuse") {
    console.log(`Tour already running at http://127.0.0.1:${portResult.port}${path}`);
    return;
  }

  const { resource: server, port: boundPort, preferredWasBusy } = portResult;
  const url = `http://127.0.0.1:${boundPort}${path}`;
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
      server.stop();
      resolve();
    }
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  });
}
