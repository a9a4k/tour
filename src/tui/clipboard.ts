import { spawnSync } from "node:child_process";

// Clipboard write for the TUI (issue #326).
//
// Primary path: shell out to the platform's clipboard binary (`pbcopy` on
// macOS, `wl-copy`/`xclip`/`xsel` on Linux, `clip.exe` on Windows). Works
// locally regardless of terminal emulator, multiplexer (tmux/zellij/
// TUICommander), or OSC 52 capability advertisement — the same approach
// lazygit and k9s ship.
//
// Fallback path: OSC 52 via the opentui renderer. Covers SSH sessions
// where the platform clipboard binary isn't reachable from the remote
// shell. Opentui gates on terminal capability advertisement and silently
// returns false if not detected, so this is genuinely best-effort.

export interface ClipboardSink {
  copyToClipboardOSC52(text: string): boolean;
}

type Candidate = { cmd: string; args: string[] };

function platformCandidates(): Candidate[] {
  if (process.platform === "darwin") return [{ cmd: "pbcopy", args: [] }];
  if (process.platform === "win32") return [{ cmd: "clip", args: [] }];
  if (process.platform === "linux") {
    return [
      { cmd: "wl-copy", args: [] },
      { cmd: "xclip", args: ["-selection", "clipboard"] },
      { cmd: "xsel", args: ["-b", "-i"] },
    ];
  }
  return [];
}

function trySpawnClipboard(text: string): boolean {
  for (const { cmd, args } of platformCandidates()) {
    try {
      const result = spawnSync(cmd, args, { input: text, encoding: "utf-8" });
      if (!result.error && result.status === 0) return true;
    } catch {
      // ENOENT / EACCES — try the next candidate.
    }
  }
  return false;
}

export function yankToClipboard(text: string, fallbackSink: ClipboardSink): boolean {
  if (trySpawnClipboard(text)) return true;
  return fallbackSink.copyToClipboardOSC52(text);
}
