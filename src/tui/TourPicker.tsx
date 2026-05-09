import type { PickerRow } from "../core/tour-list.js";

interface TourPickerProps {
  rows: PickerRow[];
  currentTourId: string | null;
  cursor: number;
}

function rowLabel(r: PickerRow): string {
  const age = r.age.padEnd(10);
  const badge = r.annotationCount > 0 ? `  [${r.annotationCount}]` : "";
  return ` ${r.glyph} ${age}  ${r.title}${badge} `;
}

export function TourPicker({ rows, currentTourId, cursor }: TourPickerProps) {
  return (
    <box
      position="absolute"
      top={2}
      left="10%"
      right="10%"
      bottom={2}
      borderStyle="single"
      borderColor="cyan"
      title=" Select Tour "
      flexDirection="column"
      zIndex={100}
      backgroundColor="black"
    >
      <scrollbox height="100%">
        {rows.length === 0 ? (
          <text fg="gray">{" (no tours) "}</text>
        ) : (
          rows.map((r, i) => {
            const isCurrent = r.id === currentTourId;
            const isCursor = i === cursor;
            let bg: string | undefined;
            if (isCursor) bg = "cyan";
            else if (isCurrent) bg = "blue";
            return (
              <text
                key={r.id}
                fg={isCursor ? "black" : "white"}
                bg={bg}
                bold={isCursor}
              >
                {rowLabel(r)}
              </text>
            );
          })
        )}
      </scrollbox>
      <box height={1} paddingX={1}>
        <text fg="gray">
          {" j/k: move  ·  Enter: select  ·  t/Esc: close "}
        </text>
      </box>
    </box>
  );
}
