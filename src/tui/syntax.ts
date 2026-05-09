import { RGBA, SyntaxStyle, pathToFiletype } from "@opentui/core";

// Tree-sitter grammars bundled in @opentui/core. Anything outside this set
// renders as plain text so we never block on missing wasm.
const SUPPORTED_FILETYPES = new Set([
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact",
  "markdown",
]);

export function inferFiletype(filename: string): string | undefined {
  const ft = pathToFiletype(filename);
  if (ft && SUPPORTED_FILETYPES.has(ft)) return ft;
  return undefined;
}

let cachedStyle: SyntaxStyle | null = null;

export function getSyntaxStyle(): SyntaxStyle {
  if (cachedStyle) return cachedStyle;
  cachedStyle = SyntaxStyle.fromStyles({
    keyword: { fg: RGBA.fromHex("#FF7B72"), bold: true },
    "keyword.import": { fg: RGBA.fromHex("#FF7B72"), bold: true },
    "keyword.return": { fg: RGBA.fromHex("#FF7B72"), bold: true },
    "keyword.operator": { fg: RGBA.fromHex("#FF7B72") },
    string: { fg: RGBA.fromHex("#A5D6FF") },
    "string.escape": { fg: RGBA.fromHex("#A5D6FF") },
    comment: { fg: RGBA.fromHex("#8B949E"), italic: true },
    number: { fg: RGBA.fromHex("#79C0FF") },
    boolean: { fg: RGBA.fromHex("#79C0FF") },
    function: { fg: RGBA.fromHex("#D2A8FF") },
    "function.method": { fg: RGBA.fromHex("#D2A8FF") },
    "function.builtin": { fg: RGBA.fromHex("#D2A8FF") },
    constructor: { fg: RGBA.fromHex("#D2A8FF") },
    type: { fg: RGBA.fromHex("#FFA657") },
    "type.builtin": { fg: RGBA.fromHex("#FFA657") },
    property: { fg: RGBA.fromHex("#79C0FF") },
    variable: { fg: RGBA.fromHex("#E6EDF3") },
    "variable.builtin": { fg: RGBA.fromHex("#79C0FF") },
    "variable.parameter": { fg: RGBA.fromHex("#E6EDF3") },
    operator: { fg: RGBA.fromHex("#FF7B72") },
    punctuation: { fg: RGBA.fromHex("#E6EDF3") },
    "punctuation.bracket": { fg: RGBA.fromHex("#E6EDF3") },
    "punctuation.delimiter": { fg: RGBA.fromHex("#E6EDF3") },
    constant: { fg: RGBA.fromHex("#79C0FF") },
    "constant.builtin": { fg: RGBA.fromHex("#79C0FF") },
    tag: { fg: RGBA.fromHex("#7EE787") },
    "tag.attribute": { fg: RGBA.fromHex("#79C0FF") },
  });
  return cachedStyle;
}
