import { describe, expect, it } from "vitest";
import {
  resolveReplyAgentTemplate,
  validateReplyAgentTemplate,
} from "../../src/core/reply-agent-template.js";

describe("reply-agent template validation", () => {
  it("accepts templates containing any known reply-agent placeholder", () => {
    expect(() =>
      validateReplyAgentTemplate("claude --system-prompt {systemPrompt} {userPrompt}"),
    ).not.toThrow();
    expect(() =>
      validateReplyAgentTemplate("codex exec {combinedPrompt}"),
    ).not.toThrow();
  });

  it("rejects unknown placeholders with the valid placeholder list", () => {
    expect(() =>
      validateReplyAgentTemplate("claude --print {sytemPrompt}"),
    ).toThrow(
      /Unknown placeholder \{sytemPrompt\}.*\{systemPrompt\}.*\{userPrompt\}.*\{combinedPrompt\}/,
    );
  });

  it("rejects templates with no placeholders and includes migration examples for config values", () => {
    expect(() =>
      validateReplyAgentTemplate("claude", "/tmp/tour-home/config.toml"),
    ).toThrow(
      /Invalid reply_agent in \/tmp\/tour-home\/config.toml: "claude"[\s\S]*Placeholders: \{systemPrompt\}, \{userPrompt\}, \{combinedPrompt\}[\s\S]*reply_agent = "claude --print --allowedTools Read,Grep,Glob,Bash --system-prompt \{systemPrompt\} \{userPrompt\}"[\s\S]*reply_agent = "codex exec --skip-git-repo-check \{combinedPrompt\}"/,
    );
  });
});

describe("resolveReplyAgentTemplate", () => {
  it("uses the flag template before the config template", () => {
    expect(
      resolveReplyAgentTemplate(
        "claude --print {userPrompt}",
        "codex exec {combinedPrompt}",
        "/tmp/tour-home/config.toml",
      ),
    ).toEqual({ replyAgent: "claude --print {userPrompt}" });
  });

  it("keeps config provenance when the config template wins", () => {
    expect(
      resolveReplyAgentTemplate(
        undefined,
        "codex exec {combinedPrompt}",
        "/tmp/tour-home/config.toml",
      ),
    ).toEqual({
      replyAgent: "codex exec {combinedPrompt}",
      replyAgentSourcePath: "/tmp/tour-home/config.toml",
    });
  });
});
