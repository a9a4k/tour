import {
  renderCommandTemplate,
  type CommandTemplateValidationError,
} from "./command-template.js";

export const REPLY_AGENT_PLACEHOLDERS = [
  "systemPrompt",
  "userPrompt",
  "combinedPrompt",
] as const;

const REPLY_AGENT_EXAMPLES = `Examples:
reply_agent = "claude --print --allowedTools Read,Grep,Glob,Bash --system-prompt {systemPrompt} {userPrompt}"
reply_agent = "codex exec --skip-git-repo-check {combinedPrompt}"
reply_agent = "gemini --prompt {combinedPrompt}"
reply_agent = "opencode run {combinedPrompt}"
reply_agent = "pi --print --allowedTools Read,Grep,Glob,Bash --system-prompt {systemPrompt} {userPrompt}"`;

function validPlaceholderLabels(): string[] {
  return REPLY_AGENT_PLACEHOLDERS.map((name) => `{${name}}`);
}

function hasKnownReplyAgentPlaceholder(template: string): boolean {
  return REPLY_AGENT_PLACEHOLDERS.some((name) => template.includes(`{${name}}`));
}

function formatValidationError(error: CommandTemplateValidationError): string {
  switch (error.kind) {
    case "empty-template":
      return `Reply-agent template must not be empty. Valid placeholders: ${error.validPlaceholders.join(", ")}`;
    case "unknown-placeholder":
      return `Unknown placeholder ${error.placeholder}. Valid placeholders: ${error.validPlaceholders.join(", ")}`;
  }
}

function formatMissingPlaceholderError(template: string, sourcePath?: string): string {
  const source = sourcePath
    ? `Invalid reply_agent in ${sourcePath}: ${JSON.stringify(template)}`
    : `Invalid --reply-agent template: ${JSON.stringify(template)}`;
  return `${source}

Reply-agent templates must include at least one Tour prompt placeholder.
Placeholders: ${validPlaceholderLabels().join(", ")}

${REPLY_AGENT_EXAMPLES}`;
}

export function validateReplyAgentTemplate(
  template: string,
  sourcePath?: string,
): void {
  const substitutions = Object.fromEntries(
    REPLY_AGENT_PLACEHOLDERS.map((name) => [name, `{${name}}`]),
  );
  const rendered = renderCommandTemplate(
    template,
    substitutions,
    REPLY_AGENT_PLACEHOLDERS,
  );
  if (!Array.isArray(rendered)) {
    throw new Error(formatValidationError(rendered));
  }
  if (!hasKnownReplyAgentPlaceholder(template)) {
    throw new Error(formatMissingPlaceholderError(template, sourcePath));
  }
}

export function resolveReplyAgentTemplate(
  flagValue: string | undefined,
  configValue: string | undefined,
  configPath: string,
): { replyAgent?: string; replyAgentSourcePath?: string } {
  if (flagValue !== undefined) {
    validateReplyAgentTemplate(flagValue);
    return { replyAgent: flagValue };
  }
  if (configValue !== undefined && configValue !== "") {
    validateReplyAgentTemplate(configValue, configPath);
    return { replyAgent: configValue, replyAgentSourcePath: configPath };
  }
  return {};
}
