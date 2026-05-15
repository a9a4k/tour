import { describe, it, expect } from "vitest";
import { buildArgs } from "../../src/agents/codex.js";
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
  triggering_comment: {
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

describe("codex buildArgs", () => {
  it("uses the `exec` non-interactive subcommand as the first positional", () => {
    const argv = buildArgs(ENVELOPE, "SYSTEM_PROMPT_TEXT");
    expect(argv[0]).toBe("exec");
  });

  it("passes --skip-git-repo-check so codex runs inside Tour's pinned working tree", () => {
    const argv = buildArgs(ENVELOPE, "SYSTEM_PROMPT_TEXT");
    expect(argv).toContain("--skip-git-repo-check");
  });

  it("places the prompt as the final positional after all flags", () => {
    const argv = buildArgs(ENVELOPE, "SYSTEM_PROMPT_TEXT");
    const prompt = argv[argv.length - 1];
    expect(prompt.startsWith("--")).toBe(false);
    expect(argv.indexOf("--skip-git-repo-check")).toBeLessThan(argv.length - 1);
  });

  it("folds the system prompt into the prompt argument (codex has no --system-prompt flag)", () => {
    const argv = buildArgs(ENVELOPE, "SYSTEM_PROMPT_TEXT");
    const prompt = argv[argv.length - 1];
    expect(prompt).toContain("SYSTEM_PROMPT_TEXT");
    expect(prompt).toContain("abc123");
    expect(prompt).toContain("2026-05-10-120000-test");
  });

  it("does not pass any allow/deny tool configuration (zero tools, ADR 0012)", () => {
    const argv = buildArgs(ENVELOPE, "SYSTEM_PROMPT_TEXT");
    expect(argv).not.toContain("--sandbox");
    expect(argv).not.toContain("--ask-for-approval");
    expect(argv).not.toContain("--allowed-tools");
    expect(argv).not.toContain("--disallowed-tools");
  });
});
