import { createRoot } from "react-dom/client";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import { App } from "./App.js";

declare global {
  interface Window {
    __INITIAL_TOUR_ID__?: string | null;
  }
}

// Pierre's worker is bundled as a second Bun.build entrypoint by
// server.ts and served at /pierre-worker.js. We reference that URL
// directly because Bun.build does not rewrite the
// `new URL("@pierre/diffs/worker/worker.js", import.meta.url)` pattern
// across npm packages (Vite/webpack do; Bun does not yet).
function workerFactory(): Worker {
  return new Worker("/pierre-worker.js", { type: "module" });
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root element");

// Wrap App with the worker pool. With this, Pierre's syntax-highlighting
// AST work runs off the main thread — opening / scrolling the diff no
// longer blocks click and keystroke handlers in App.tsx on Shiki parses.
createRoot(rootEl).render(
  <WorkerPoolContextProvider
    poolOptions={{ workerFactory, poolSize: 3 }}
    highlighterOptions={{
      theme: { dark: "github-dark-default", light: "github-light-default" },
    }}
  >
    <App initialTourId={window.__INITIAL_TOUR_ID__ ?? null} />
  </WorkerPoolContextProvider>,
);
