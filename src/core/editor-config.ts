// Editor resolution (PRD #349 / ADR 0032 / issue #352). Pure module: a
// single resolution chain shared by both surfaces evaluates `--editor`
// flag → $TOUR_EDITOR → Tour config → $VISUAL → $EDITOR → null and returns an
// EditorConfig that downstream code never re-parses.
//
// Template handling: if the configured value contains `{file}` and/or
// `{line}`, substitute. Otherwise infer per binary basename
// (code/cursor/codium → `-g {file}:{line}`; idea family → `--line
// {line} {file}`; vim/nvim/nano/emacs/hx/vi/micro → `+{line} {file}`;
// unknown → `{file}:{line}`). Spawn uses `execFile` with the parsed
// argv (never `sh -c`) so paths with spaces or special characters are
// injection-safe.
//
// Terminal-editor classification is a fixed allowlist by binary
// basename: {vim, nvim, vi, nano, emacs, hx, micro}. Wrappers that
// delegate to a terminal editor are not detected (out of scope).

export interface EditorConfig {
  /** The first token of the configured command. Carried as-is so a user
   *  who passes an absolute path keeps it; `spawn` accepts both. */
  bin: string;
  /** Build the argv tail for a given (file, line) target. The first
   *  element is the first arg passed to the binary; the binary itself
   *  is `bin`, not part of this list. */
  argv: (file: string, line: number) => string[];
  /** True when the binary basename matches the terminal-editor
   *  allowlist. The webapp refuses these; the TUI takes a different
   *  spawn path (suspend / inherit / resume; lands in #355). */
  terminal: boolean;
}

export interface EditorEnv {
  TOUR_EDITOR?: string;
  VISUAL?: string;
  EDITOR?: string;
}

const TERMINAL_EDITORS = new Set([
  "vim",
  "nvim",
  "vi",
  "nano",
  "emacs",
  "hx",
  "micro",
]);

const VSCODE_FAMILY = new Set(["code", "cursor", "codium"]);
const JETBRAINS_FAMILY = new Set([
  "idea",
  "webstorm",
  "pycharm",
  "rubymine",
  "clion",
  "goland",
  "phpstorm",
]);

function basename(p: string): string {
  const slash = p.lastIndexOf("/");
  return slash === -1 ? p : p.slice(slash + 1);
}

function firstNonEmpty(...candidates: Array<string | undefined>): string | null {
  for (const c of candidates) {
    if (c !== undefined && c !== "") return c;
  }
  return null;
}

export function resolveEditor(
  flag: string | undefined,
  env: EditorEnv,
  configEditor?: string,
): EditorConfig | null {
  const raw = firstNonEmpty(
    flag,
    env.TOUR_EDITOR,
    configEditor,
    env.VISUAL,
    env.EDITOR,
  );
  if (raw === null) return null;

  // Split on whitespace into bin + args. Naive split is fine for the
  // common case; users with shell-quoted args in $EDITOR (`'code --wait'`)
  // can pass `--editor` with a template instead.
  const tokens = raw.trim().split(/\s+/);
  if (tokens.length === 0 || tokens[0] === "") return null;
  const bin = tokens[0];
  const rest = tokens.slice(1);
  const base = basename(bin);
  const terminal = TERMINAL_EDITORS.has(base);

  const hasFile = rest.some((t) => t.includes("{file}"));
  const hasLine = rest.some((t) => t.includes("{line}"));
  if (hasFile || hasLine) {
    return {
      bin,
      argv: (file, line) =>
        rest.map((t) =>
          t.replace(/\{file\}/g, file).replace(/\{line\}/g, String(line)),
        ),
      terminal,
    };
  }

  const suffix = (file: string, line: number): string[] => {
    if (VSCODE_FAMILY.has(base)) return ["-g", `${file}:${line}`];
    if (JETBRAINS_FAMILY.has(base)) return ["--line", String(line), file];
    if (TERMINAL_EDITORS.has(base)) return [`+${line}`, file];
    return [`${file}:${line}`];
  };

  return {
    bin,
    argv: (file, line) => [...rest, ...suffix(file, line)],
    terminal,
  };
}
