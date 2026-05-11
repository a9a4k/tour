// Shared rename-label helpers used by the TUI and web surfaces so the
// header path-pair and pure-rename placeholder body stay textually
// identical between surfaces (issue #145).

export const RENAME_PLACEHOLDER_BODY = "File renamed without changes.";

export function formatRenameLabel(
  name: string,
  prevName: string | undefined,
): string | null {
  if (!prevName || prevName === name) return null;
  return `${prevName} → ${name}`;
}
