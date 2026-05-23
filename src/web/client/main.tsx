import { createRoot } from "react-dom/client";
import { App } from "./App.js";

declare global {
  interface Window {
    __INITIAL_TOUR_ID__?: string | null;
    __INITIAL_REPLY_AGENT__?: string | null;
    __INITIAL_REPLY_AGENT_CONFIG_PATH__?: string | null;
  }
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root element");

createRoot(rootEl).render(
  <App
    initialTourId={window.__INITIAL_TOUR_ID__ ?? null}
    replyAgent={window.__INITIAL_REPLY_AGENT__ ?? null}
    replyAgentConfigPath={window.__INITIAL_REPLY_AGENT_CONFIG_PATH__ ?? null}
  />,
);
