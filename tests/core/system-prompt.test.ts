import { describe, it, expect } from "vitest";
import { replyAgentSystemPrompt } from "../../src/core/system-prompt.js";

describe("replyAgentSystemPrompt", () => {
  it("matches the locked-in canonical text", () => {
    // Snapshot test: the prompt is correctness-critical (it semantically
    // reinforces the runtime tool restriction). Changes should be deliberate
    // and visible in the diff. Compared as a stable hash so quote-escape
    // wobbles in the inline-snapshot serializer don't make the test brittle.
    expect(replyAgentSystemPrompt().length).toBeGreaterThan(500);
    expect(replyAgentSystemPrompt()).toMatchSnapshot();
  });

  it("contains the capability boundary phrasing", () => {
    const prompt = replyAgentSystemPrompt();
    expect(prompt).toContain("tour annotate --as-agent --reply-to");
    expect(prompt).toContain("may NOT edit code");
  });

  it("contains the silent-exit guidance", () => {
    const prompt = replyAgentSystemPrompt();
    expect(prompt).toContain("Exit silently");
  });
});
