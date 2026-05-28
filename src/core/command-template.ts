export type CommandTemplateValidationError =
  | {
      kind: "empty-template";
      validPlaceholders: string[];
    }
  | {
      kind: "unknown-placeholder";
      placeholder: string;
      validPlaceholders: string[];
    };

export type CommandTemplateRenderResult =
  | string[]
  | CommandTemplateValidationError;

function placeholderLabels(knownPlaceholders: readonly string[]): string[] {
  return knownPlaceholders.map((name) => `{${name}}`);
}

function isValidationError(
  value: CommandTemplateRenderResult,
): value is CommandTemplateValidationError {
  return typeof value === "object" && !Array.isArray(value);
}

export function renderCommandTemplate(
  template: string,
  substitutions: Record<string, string>,
  knownPlaceholders: readonly string[],
): CommandTemplateRenderResult {
  const validPlaceholders = placeholderLabels(knownPlaceholders);
  const trimmed = template.trim();
  if (trimmed === "") {
    return { kind: "empty-template", validPlaceholders };
  }

  const known = new Set(knownPlaceholders);
  const unknown = trimmed.match(/\{[^{}\s]+\}/g)?.find((token) => {
    const name = token.slice(1, -1);
    return !known.has(name);
  });
  if (unknown) {
    return {
      kind: "unknown-placeholder",
      placeholder: unknown,
      validPlaceholders,
    };
  }

  return trimmed.split(/\s+/).map((token) => {
    let rendered = token;
    for (const name of knownPlaceholders) {
      rendered = rendered.replaceAll(`{${name}}`, substitutions[name] ?? "");
    }
    return rendered;
  });
}

export function assertRenderedCommand(
  result: CommandTemplateRenderResult,
): string[] {
  if (!isValidationError(result)) return result;
  switch (result.kind) {
    case "empty-template":
      throw new Error("Command template must not be empty");
    case "unknown-placeholder":
      throw new Error(
        `Unknown placeholder ${result.placeholder}. Valid placeholders: ${result.validPlaceholders.join(", ")}`,
      );
  }
}
