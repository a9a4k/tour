import { describe, expect, it } from "vitest";
import { renderCommandTemplate } from "../../src/core/command-template.js";

const known = ["systemPrompt", "userPrompt", "combinedPrompt"];
const substitutions = {
  systemPrompt: "system\nprompt with \"quotes\"",
  userPrompt: "user prompt",
  combinedPrompt: "combined prompt",
};

describe("renderCommandTemplate", () => {
  it("tokenizes on whitespace and substitutes placeholders inside argv elements", () => {
    const rendered = renderCommandTemplate(
      "claude --system-prompt={systemPrompt} {userPrompt}",
      substitutions,
      known,
    );

    expect(rendered).toEqual([
      "claude",
      "--system-prompt=system\nprompt with \"quotes\"",
      "user prompt",
    ]);
  });

  it("replaces multiple occurrences without shell-splitting substituted values", () => {
    const rendered = renderCommandTemplate(
      "echo {userPrompt}:{userPrompt}",
      substitutions,
      known,
    );

    expect(rendered).toEqual(["echo", "user prompt:user prompt"]);
  });

  it("rejects unknown placeholders case-sensitively", () => {
    const typo = renderCommandTemplate("claude {sytemPrompt}", substitutions, known);
    const wrongCase = renderCommandTemplate("claude {SystemPrompt}", substitutions, known);

    expect(typo).toEqual({
      kind: "unknown-placeholder",
      placeholder: "{sytemPrompt}",
      validPlaceholders: ["{systemPrompt}", "{userPrompt}", "{combinedPrompt}"],
    });
    expect(wrongCase).toEqual({
      kind: "unknown-placeholder",
      placeholder: "{SystemPrompt}",
      validPlaceholders: ["{systemPrompt}", "{userPrompt}", "{combinedPrompt}"],
    });
  });

  it("rejects empty templates", () => {
    expect(renderCommandTemplate("   ", substitutions, known)).toEqual({
      kind: "empty-template",
      validPlaceholders: ["{systemPrompt}", "{userPrompt}", "{combinedPrompt}"],
    });
  });
});
