import hljs from "highlight.js/lib/common";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

hljs.registerLanguage("dockerfile", dockerfile);

const EXT_TO_LANG: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".json": "json",
  ".md": "markdown",
  ".css": "css",
  ".scss": "scss",
  ".less": "less",
  ".html": "xml",
  ".xml": "xml",
  ".svg": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "ini",
  ".ini": "ini",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cc": "cpp",
  ".cs": "csharp",
  ".swift": "swift",
  ".sql": "sql",
  ".r": "r",
  ".lua": "lua",
  ".pl": "perl",
  ".php": "php",
  ".m": "objectivec",
  ".mm": "objectivec",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".wasm": "wasm",
  ".makefile": "makefile",
  ".mk": "makefile",
  ".vb": "vbnet",
};

const BASENAME_TO_LANG: Record<string, string> = {
  Dockerfile: "dockerfile",
  Makefile: "makefile",
  Rakefile: "ruby",
  Gemfile: "ruby",
};

export function langFromPath(filePath: string): string | null {
  const basename = filePath.split("/").pop() ?? "";
  if (BASENAME_TO_LANG[basename]) return BASENAME_TO_LANG[basename];
  const dotIdx = basename.lastIndexOf(".");
  if (dotIdx === -1) return null;
  const ext = basename.slice(dotIdx).toLowerCase();
  return EXT_TO_LANG[ext] ?? null;
}

export function highlightLine(code: string, language: string): string {
  return hljs.highlight(code, { language, ignoreIllegals: true }).value;
}

export function highlightDiffLines(rawDiff: string): (string | null)[] {
  const lines = rawDiff.split("\n");
  const result: (string | null)[] = [];
  let currentLang: string | null = null;

  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      const match = line.match(/b\/(.+)$/);
      currentLang = match ? langFromPath(match[1]) : null;
      result.push(null);
    } else if (currentLang && line.startsWith("+") && !line.startsWith("+++")) {
      result.push(highlightLine(line.slice(1), currentLang));
    } else if (currentLang && line.startsWith("-") && !line.startsWith("---")) {
      result.push(highlightLine(line.slice(1), currentLang));
    } else if (currentLang && line.startsWith(" ")) {
      result.push(highlightLine(line.slice(1), currentLang));
    } else {
      result.push(null);
    }
  }

  return result;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

let _themeCSS: string | null = null;

export function hljsThemeCSS(): string {
  if (!_themeCSS) {
    const themePath = resolve(
      __dirname,
      "../../node_modules/highlight.js/styles/github-dark.min.css",
    );
    _themeCSS = readFileSync(themePath, "utf8");
  }
  return _themeCSS;
}
