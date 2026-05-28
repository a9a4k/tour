const PLACEHOLDER_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function placeholdersIn(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER_RE)].map((m) => m[1]);
}

export function renderCommandTemplate(
  template: string,
  substitutions: Record<string, string>,
  knownPlaceholders: readonly string[],
): string[] {
  const tokens = template.trim().split(/\s+/).filter(Boolean);
  const known = new Set(knownPlaceholders);
  const unknown = placeholdersIn(template).find((name) => !known.has(name));
  if (unknown !== undefined) {
    throw new Error(
      `Unknown template placeholder "{${unknown}}". Valid placeholders: ${knownPlaceholders
        .map((name) => `{${name}}`)
        .join(", ")}`,
    );
  }
  return tokens.map((token) => {
    let out = token;
    for (const [name, value] of Object.entries(substitutions)) {
      out = out.replaceAll(`{${name}}`, value);
    }
    return out;
  });
}
