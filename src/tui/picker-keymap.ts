// Picker-open keyboard dispatch (issue #340 / ADR 0030).
//
// While the Tour picker is open, the surface-level key handler in
// `app.tsx` bypasses the main keymap dispatcher (`dispatchKey`) — the
// dispatcher's targets (cursor, files, composers) don't apply when the
// picker overlay is the focused chrome. This module is the picker
// overlay's own dispatcher: a small pure function that maps a KeyInput
// to one of close / move / commit / noop.
//
// Symmetric open/close on `T` / Shift+T was introduced in issue #340:
// the picker opens via Shift+T (per ADR 0030, capital = Tour-wide) and
// now closes via Shift+T too. Bare `t` is a plain noop in every state
// after the #337 cutover — that includes this overlay.

import type { KeyInput } from "./keymap.js";

export type PickerKeyAction =
  | { type: "close" }
  | { type: "move"; delta: number }
  | { type: "commit" }
  | { type: "noop" };

export function dispatchPickerKey(key: KeyInput): PickerKeyAction {
  if (key.name === "escape") return { type: "close" };
  if (!key.ctrl && key.shift && key.name === "t") return { type: "close" };
  if (key.ctrl || key.shift) return { type: "noop" };
  if (key.name === "j" || key.name === "down") return { type: "move", delta: 1 };
  if (key.name === "k" || key.name === "up") return { type: "move", delta: -1 };
  if (key.name === "return") return { type: "commit" };
  return { type: "noop" };
}
