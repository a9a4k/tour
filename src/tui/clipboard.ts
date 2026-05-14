// OSC 52 clipboard write (issue #326). Failure is unobservable — bytes
// either reach the host terminal or are absorbed by an intermediate
// (e.g. tmux without `set-clipboard on`). Matches the webapp's silent-
// failure copy-path semantics from #319 so the two surfaces share one
// failure rule.

export interface ClipboardSink {
  write(bytes: string): void;
}

const defaultSink: ClipboardSink = {
  write: (bytes) => {
    process.stdout.write(bytes);
  },
};

// Terminator is BEL (`\x07`), not ST — BEL is what the widely-deployed
// implementations actually accept.
export function yankToClipboard(text: string, sink: ClipboardSink = defaultSink): void {
  const payload = Buffer.from(text, "utf-8").toString("base64");
  sink.write(`\x1b]52;c;${payload}\x07`);
}
