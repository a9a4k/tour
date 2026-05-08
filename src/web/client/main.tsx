import { createRoot } from "react-dom/client";
import { App } from "./App.js";

declare global {
  interface Window {
    __INITIAL_TOUR_ID__?: string | null;
  }
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root element");

createRoot(rootEl).render(<App initialTourId={window.__INITIAL_TOUR_ID__ ?? null} />);
