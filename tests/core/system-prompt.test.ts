import { describe, it, expect } from "vitest";
import { replyAgentSystemPrompt } from "../../src/core/system-prompt.js";

describe("replyAgentSystemPrompt", () => {
  it("matches the locked-in canonical text", () => {
    // Snapshot test: the prompt is correctness-critical (it semantically
    // reinforces the runtime stdout-as-reply contract from ADR 0012).
    // Changes should be deliberate and visible in the diff.
    expect(replyAgentSystemPrompt().length).toBeGreaterThan(500);
    expect(replyAgentSystemPrompt()).toMatchSnapshot();
  });

  it("contains the output contract section (ADR 0012)", () => {
    const prompt = replyAgentSystemPrompt();
    // The output contract block teaches the model that its stdout is the
    // reply body, and enumerates the failure modes (preamble, narration,
    // sign-off) to suppress.
    expect(prompt).toContain("Output contract");
    expect(prompt).toContain("Your stdout IS the reply");
  });

  it("frames tool access as template-controlled scope, not a Tour sandbox", () => {
    const prompt = replyAgentSystemPrompt();
    expect(prompt).toContain("Capabilities and scope");
    expect(prompt).toContain("user's reply-agent command");
    expect(prompt).toContain("Do not intentionally edit code");
    expect(prompt).not.toContain("You have no tools");
    // The previous tool-call dispatch language is gone.
    expect(prompt).not.toContain("tour annotate --as-agent --reply-to");
  });

  it("retains the always-reply guidance", () => {
    const prompt = replyAgentSystemPrompt();
    expect(prompt).toContain("Always reply");
    expect(prompt).toContain("Never exit without writing a reply");
  });

  it("speaks the Comment vocabulary, never the old Annotation term (ADR 0029)", () => {
    // PRD #335 / issue #339: the prompt shapes what every reply-agent
    // invocation writes from this release forward. If the prompt drifts
    // back to the old vocabulary, agent output drifts with it. The
    // string literal "annotation" here is the legacy term we're guarding
    // against — preserved as a regression sentinel, not as live vocab.
    const prompt = replyAgentSystemPrompt();
    expect(prompt).not.toMatch(/annotation/i);
    expect(prompt).toContain("responding to a Reply or Comment");
    expect(prompt).toContain("writes that as the Comment body — verbatim");
  });
});
