// Editor resolution (PRD #466 / issue #468). Pure module: a single
// resolution chain shared by both surfaces evaluates `--editor` flag →
// $TOUR_EDITOR → Tour config → $VISUAL → $EDITOR → null and returns an
// EditorConfig that downstream code never re-parses.

import { placeholdersIn, renderCommandTemplate } from "./command-template.js";

export interface EditorConfig {
  /** Raw command template selected by the resolution chain. */
  template: string;
  /** The first token of the configured command. Carried as-is so a user
   *  who passes an absolute path keeps it; `spawn` accepts both. */
  bin: string;
  /** Build the argv tail for a given (file, line) target. The first
   *  element is the first arg passed to the binary; the binary itself
   *  is `bin`, not part of this list. */
  argv: (file: string, line: number) => string[];
  /** True when `editor_terminal = true` is set in user config. */
  terminal: boolean;
}

export interface EditorEnv {
  TOUR_EDITOR?: string;
  VISUAL?: string;
  EDITOR?: string;
}

export interface EditorConfigSource {
  editor?: string;
  editorTerminal?: boolean;
}

export function chooseFirstWithSource<Source extends string>(
  ...candidates: Array<{ value: string | undefined; source: Source }>
): { value: string | null; source: Source | "default" } {
  for (const c of candidates) {
    if (c.value !== undefined && c.value !== "") {
      return { value: c.value, source: c.source };
    }
  }
  return { value: null, source: "default" };
}

const EDITOR_PLACEHOLDERS = ["file", "line", "workspace"] as const;

export function invalidEditorTemplateMessage(value: string, configPath?: string): string {
  const location =
    configPath === undefined ? "Editor template" : `Editor template in ${configPath}`;
  return `${location} must include {file}. Rejected value: ${JSON.stringify(value)}
Placeholders: {file} required, {line} optional.
Examples:
  code -g {file}:{line}
  cursor -g {file}:{line}
  idea --line {line} {file}
  vim +{line} {file}
  nvim +{line} {file}`;
}

export function validateEditorTemplate(value: string, configPath?: string): void {
  const placeholders = placeholdersIn(value);
  if (!placeholders.includes("file")) {
    throw new Error(invalidEditorTemplateMessage(value, configPath));
  }
  const unknown = placeholders.find(
    (name) => !(EDITOR_PLACEHOLDERS as readonly string[]).includes(name),
  );
  if (unknown !== undefined) {
    const location =
      configPath === undefined ? "Editor template" : `Editor template in ${configPath}`;
    throw new Error(
      `${location} contains unknown placeholder "{${unknown}}". Valid placeholders: {file}, {line}, {workspace}`,
    );
  }
}

function normalizeConfigSource(
  config: string | EditorConfigSource | undefined,
): { editor?: string; editorTerminal: boolean } {
  if (typeof config === "string") {
    return { editor: config, editorTerminal: false };
  }
  return {
    editor: config?.editor,
    editorTerminal: config?.editorTerminal ?? false,
  };
}

export function resolveEditor(
  flag: string | undefined,
  env: EditorEnv,
  configEditor?: string | EditorConfigSource,
  repoRoot?: string,
): EditorConfig | null {
  const config = normalizeConfigSource(configEditor);
  const { value: raw } = chooseFirstWithSource(
    { value: flag, source: "flag" },
    { value: env.TOUR_EDITOR, source: "$TOUR_EDITOR" },
    { value: config.editor, source: "config" },
    { value: env.VISUAL, source: "$VISUAL" },
    { value: env.EDITOR, source: "$EDITOR" },
  );
  if (raw === null) return null;
  validateEditorTemplate(raw);

  // Split on whitespace into bin + args. Naive split is fine for the
  // common case; users with shell-quoted args in $EDITOR (`'code --wait'`)
  // can pass `--editor` with a template instead.
  const tokens = raw.trim().split(/\s+/);
  if (tokens.length === 0 || tokens[0] === "") return null;
  const bin = tokens[0];
  const rest = tokens.slice(1);

  return {
    template: raw,
    bin,
    argv: (file, line) =>
      renderCommandTemplate(
        rest.join(" "),
        {
          file,
          line: String(line),
          workspace: repoRoot ?? "{workspace}",
        },
        EDITOR_PLACEHOLDERS,
      ),
    terminal: config.editorTerminal,
  };
}
