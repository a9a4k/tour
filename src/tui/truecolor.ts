// Truecolor terminal detection. Shiki tokens carry 24-bit hex colours
// (`#RRGGBB`) — on terminals without truecolor support they would be
// approximated to the nearest 256-colour, often badly. PRD #374
// requires "wrongly highlighted" never beat "plain text", so on
// non-truecolor terminals the TUI paint adapter is bypassed.

export function isTruecolorTerminal(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.COLORTERM?.toLowerCase();
  return v === "truecolor" || v === "24bit";
}
