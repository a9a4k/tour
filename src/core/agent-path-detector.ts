// Subset of the shipped-agents list that is reachable on the caller's PATH
// (issue #174). The PATH lookup is injected so this module stays a pure
// function of its inputs — the caller in `src/web/server.ts` plugs in a
// real `command -v <cmd>` probe (or platform-equivalent).

export function detectAgentsOnPath(
  shipped: string[],
  isOnPath: (cmd: string) => boolean,
): string[] {
  return shipped.filter((name) => isOnPath(name));
}
