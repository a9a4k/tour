export interface KeyInput {
  name: string;
  ctrl: boolean;
  shift: boolean;
}

export interface KeymapContext {
  sidebarFocused: boolean;
  fileCount: number;
}

export type KeyAction =
  | { type: "quit" }
  | { type: "toggle-pane" }
  | { type: "focus-sidebar" }
  | { type: "move-file-down" }
  | { type: "move-file-up" }
  | { type: "select-file" }
  | { type: "toggle-collapse" }
  | { type: "next-annotation" }
  | { type: "prev-annotation" }
  | { type: "noop" };

export function dispatchKey(key: KeyInput, ctx: KeymapContext): KeyAction {
  if (key.name === "q" || (key.ctrl && key.name === "c")) {
    return { type: "quit" };
  }

  if (key.name === "tab") {
    return key.shift ? { type: "focus-sidebar" } : { type: "toggle-pane" };
  }

  if (!key.ctrl && !key.shift) {
    if (key.name === "n") return { type: "next-annotation" };
    if (key.name === "p") return { type: "prev-annotation" };
  }

  if (ctx.sidebarFocused && ctx.fileCount > 0) {
    if (key.name === "j" || key.name === "down") return { type: "move-file-down" };
    if (key.name === "k" || key.name === "up") return { type: "move-file-up" };
    if (key.name === "return") return { type: "select-file" };
    if (key.name === "space") return { type: "toggle-collapse" };
  }

  return { type: "noop" };
}
