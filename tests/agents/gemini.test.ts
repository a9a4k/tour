import { describe, it, expect } from "vitest";
import { buildArgs } from "../../src/agents/gemini.js";
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

describe("gemini buildArgs", () => {
  it("uses --prompt for non-interactive single-shot mode", () => {
    const argv = buildArgs(ENVELOPE, "SYSTEM_PROMPT_TEXT");
    expect(argv).toContain("--prompt");
  });

  it("folds the system prompt into the prompt argument (gemini has no --system-prompt flag)", () => {
    const argv = buildArgs(ENVELOPE, "SYSTEM_PROMPT_TEXT");
    const prompt = argv[argv.length - 1];
    expect(prompt).toContain("SYSTEM_PROMPT_TEXT");
    expect(prompt).toContain("abc123");
    expect(prompt).toContain("2026-05-10-120000-test");
  });

  it("does not pass any allow/deny tool configuration (zero tools, ADR 0012)", () => {
    const argv = buildArgs(ENVELOPE, "SYSTEM_PROMPT_TEXT");
    expect(argv).not.toContain("--allowed-tools");
    expect(argv).not.toContain("--exclude-tools");
  });
});
