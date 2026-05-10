import { describe, it, expect } from "vitest";
import { buildArgs } from "../../src/agents/pi.js";
import type { ReplyEnvelope } from "../../src/core/agent-adapter.js";

const ENVELOPE: ReplyEnvelope = {
  tour: {
    id: "2026-05-10-120000-test",
    title: "Test",
    status: "open",
    created_at: "2026-05-10T12:00:00Z",
    closed_at: "",
    head_sha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    base_sha: "feedfacefeedfacefeedfacefeedfacefeedface",
    head_source: "HEAD",
    base_source: "HEAD^",
    wip_snapshot: false,
  },
  triggering_annotation: {
    id: "abc123",
    file: "src/main.ts",
    side: "additions",
    line_start: 10,
    line_end: 10,
    body: "why this change?",
    author: "alice",
    author_kind: "human",
    created_at: "2026-05-10T12:00:00Z",
  },
  thread: [
    {
      id: "abc123",
      file: "src/main.ts",
      side: "additions",
      line_start: 10,
      line_end: 10,
      body: "why this change?",
      author: "alice",
      author_kind: "human",
      created_at: "2026-05-10T12:00:00Z",
    },
  ],
};

describe("pi buildArgs", () => {
  it("invokes pi in non-interactive print mode", () => {
    const argv = buildArgs(ENVELOPE, "SYSTEM_PROMPT_TEXT");
    expect(argv).toContain("--print");
  });

  it("passes the system prompt via --system-prompt", () => {
    const argv = buildArgs(ENVELOPE, "SYSTEM_PROMPT_TEXT");
    const sysIdx = argv.indexOf("--system-prompt");
    expect(sysIdx).toBeGreaterThanOrEqual(0);
    expect(argv[sysIdx + 1]).toBe("SYSTEM_PROMPT_TEXT");
  });

  it("includes the envelope tour id and triggering annotation id in the user prompt", () => {
    const argv = buildArgs(ENVELOPE, "SYSTEM_PROMPT_TEXT");
    const userPrompt = argv[argv.length - 1];
    expect(userPrompt).toContain("abc123");
    expect(userPrompt).toContain("2026-05-10-120000-test");
  });

  it("does not pass any allow/deny tool configuration (zero tools, ADR 0012)", () => {
    const argv = buildArgs(ENVELOPE, "SYSTEM_PROMPT_TEXT");
    // claude-style allow/deny — never present in pi, pinned to lock the zero-tools contract.
    expect(argv).not.toContain("--allowedTools");
    expect(argv).not.toContain("--disallowedTools");
    // Pre-port pi-specific gates that are no longer needed under stdout-as-reply.
    expect(argv).not.toContain("--tools");
    expect(argv).not.toContain("--no-extensions");
    expect(argv).not.toContain("--no-skills");
    expect(argv).not.toContain("--no-prompt-templates");
    expect(argv).not.toContain("--no-context-files");
  });
});
