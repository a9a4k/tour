import { useState } from "react";
import type { ComposerState } from "./composer-state.js";
import { theme } from "../core/theme.js";
import { shortId } from "../core/ids.js";

interface ComposerProps {
  state: ComposerState;
  onSubmit: (body: string) => void;
}

function rangeLabel(line_start: number, line_end: number): string {
  return line_start === line_end ? String(line_start) : `${line_start}-${line_end}`;
}

function contextLabel(state: ComposerState): string {
  if (state.kind === "top-level") {
    return ` New annotation · ${state.file}:${rangeLabel(state.line_start, state.line_end)} (${state.side}) `;
  }
  const p = state.parent;
  return ` Reply to #${shortId(p.id)} · ${p.file}:${rangeLabel(p.line_start, p.line_end)} (${p.side}) `;
}

export function Composer({ state, onSubmit }: ComposerProps) {
  const [value, setValue] = useState("");
  return (
    <box
      position="absolute"
      bottom={1}
      left="10%"
      right="10%"
      borderStyle="single"
      borderColor={theme.border.accent}
      title={contextLabel(state)}
      flexDirection="column"
      zIndex={100}
      backgroundColor={theme.canvas.default}
    >
      <box paddingX={1} paddingTop={1} flexDirection="row">
        <text fg={theme.fg.muted}>{"> "}</text>
        <input
          focused
          placeholder="Type your note (markdown supported)…"
          value={value}
          onInput={(v) => setValue(v)}
          onSubmit={(v) => onSubmit(v)}
          style={{ flexGrow: 1 }}
        />
      </box>
      <box height={1} paddingX={1}>
        <text fg={theme.fg.muted}>{" Enter: submit  ·  Esc: cancel "}</text>
      </box>
    </box>
  );
}
