import { describe, it, expect } from "vitest";
import { detectAgentsOnPath } from "../../src/core/agent-path-detector.js";

// Pure PATH-scan over the shipped-agents list (issue #174). The
// `isOnPath` lookup is injected so tests don't have to mock `which` or
// patch process.env.PATH — they just specify which names "exist."

describe("detectAgentsOnPath", () => {
  const SHIPPED = ["claude", "codex", "gemini", "opencode", "pi"];

  it("returns empty when no shipped agent is on PATH", () => {
    const found = detectAgentsOnPath(SHIPPED, () => false);
    expect(found).toEqual([]);
  });

  it("returns the single agent when exactly one is on PATH", () => {
    const found = detectAgentsOnPath(SHIPPED, (cmd) => cmd === "claude");
    expect(found).toEqual(["claude"]);
  });

  it("returns all agents when multiple are on PATH, in shipped order", () => {
    const found = detectAgentsOnPath(SHIPPED, (cmd) => cmd === "claude" || cmd === "codex");
    expect(found).toEqual(["claude", "codex"]);
  });

  it("preserves shipped order even when the stub matches out of order", () => {
    // The stub matches in reverse-shipped order; result must still be
    // in shipped order so the tip's "first match" is deterministic.
    const present = new Set(["pi", "opencode", "gemini", "codex", "claude"]);
    const found = detectAgentsOnPath(SHIPPED, (cmd) => present.has(cmd));
    expect(found).toEqual(SHIPPED);
  });

  it("returns empty for an empty shipped list", () => {
    expect(detectAgentsOnPath([], () => true)).toEqual([]);
  });
});
