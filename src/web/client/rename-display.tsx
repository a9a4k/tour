import React from "react";
import {
  RENAME_PLACEHOLDER_BODY,
  formatRenameLabel,
} from "../../core/rename-label.js";
import { TEXT_SELECTABLE_CLASS } from "./text-selection.js";

// Header path-pair pill (issue #145). Renders `<prev> → <new>` next to
// the `reason-tag` / copy-path button in the file-block header when
// `prevName` is set and differs from `name`. Returns null otherwise so
// non-renames look exactly as they did before.
export function RenameHeaderSpan({
  name,
  prevName,
}: {
  name: string;
  prevName: string | undefined;
}): React.JSX.Element | null {
  const label = formatRenameLabel(name, prevName);
  if (label === null) return null;
  return (
    <span
      className={`rename-path ${TEXT_SELECTABLE_CLASS}`}
      data-testid="rename-path"
    >
      {label}
    </span>
  );
}

// Pure-rename body placeholder (issue #145). Pure renames collapse with
// no hunks, leaving an empty card. Render an explicit acknowledgement
// so reviewers see that the rename was intentional.
export function RenamePlaceholderBody({
  reason,
}: {
  reason: string | undefined;
}): React.JSX.Element | null {
  if (reason !== "renamed") return null;
  return (
    <div className="rename-placeholder" data-testid="rename-placeholder">
      {RENAME_PLACEHOLDER_BODY}
    </div>
  );
}
