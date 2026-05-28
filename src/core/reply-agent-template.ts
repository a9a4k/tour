import {
  renderCommandTemplate,
  type CommandTemplateValidationError,
} from "./command-template.js";
import { USER_CONFIG_SEED } from "./user-config-seed.js";

export const REPLY_AGENT_PLACEHOLDERS = [
  "systemPrompt",
  "userPrompt",
  "combinedPrompt",
] as const;

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

${USER_CONFIG_SEED}`;
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
