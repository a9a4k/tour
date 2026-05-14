// OSC 52 clipboard write (issue #326). Emits the `ESC ] 52 ; c ; <base64>
// BEL` byte sequence the modern terminal-emulator family (alacritty, kitty,
// iTerm2, WezTerm, ghostty, foot, tmux with `set-clipboard on`) implements
// to let the running program put text on the system clipboard. The bytes
// either reach the host terminal or are absorbed by an intermediate; the
// app cannot observe failure and does not try. This decision matches the
// webapp's silent-failure copy-path semantics (#319) — one failure mode,
// one UI rule across surfaces.

export interface ClipboardSink {
  write(bytes: string): void;
}

const defaultSink: ClipboardSink = {
  write: (bytes) => {
    process.stdout.write(bytes);
  },
};

/**
 * Write `text` to the OSC 52 clipboard. The default sink targets
 * `process.stdout`; tests inject a capturing sink to assert the emitted
 * byte sequence. The terminator is BEL (`\x07`), not ST — BEL is what
 * the widely-deployed implementations actually accept.
 */
export function yankToClipboard(text: string, sink: ClipboardSink = defaultSink): void {
  const payload = Buffer.from(text, "utf-8").toString("base64");
  sink.write(`\x1b]52;c;${payload}\x07`);
}
