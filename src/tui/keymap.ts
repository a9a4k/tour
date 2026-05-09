export interface KeyInput {
  name: string;
  ctrl: boolean;
  shift: boolean;
}

export interface KeymapContext {
  sidebarFocused: boolean;
  rowCount: number;
  selectedRowKind: "folder" | "file" | null;
}

export type KeyAction =
  | { type: "quit" }
  | { type: "toggle-pane" }
  | { type: "focus-sidebar" }
  | { type: "move-file-down" }
  | { type: "move-file-up" }
  | { type: "select-file" }
  | { type: "toggle-collapse" }
  | { type: "toggle-folder" }
  | { type: "expand-folder" }
  | { type: "collapse-folder" }
  | { type: "collapse-parent" }
  | { type: "next-annotation" }
  | { type: "prev-annotation" }
  | { type: "toggle-layout" }
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
    if (key.name === "l") return { type: "toggle-layout" };
  }

  if (ctx.sidebarFocused && ctx.rowCount > 0) {
    if (key.name === "j" || key.name === "down") return { type: "move-file-down" };
    if (key.name === "k" || key.name === "up") return { type: "move-file-up" };
    if (key.name === "return") return { type: "select-file" };
    if (key.name === "space") {
      if (ctx.selectedRowKind === "folder") return { type: "toggle-folder" };
      if (ctx.selectedRowKind === "file") return { type: "toggle-collapse" };
    }
    if (key.name === "right" && ctx.selectedRowKind === "folder") {
      return { type: "expand-folder" };
    }
    if (key.name === "left") {
      if (ctx.selectedRowKind === "folder") return { type: "collapse-folder" };
      if (ctx.selectedRowKind === "file") return { type: "collapse-parent" };
    }
  }

  return { type: "noop" };
}
