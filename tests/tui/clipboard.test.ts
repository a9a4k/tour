import { describe, it, expect } from "vitest";
import { yankToClipboard, type ClipboardSink } from "../../src/tui/clipboard.js";

function captureSink(): ClipboardSink & { emitted: string[] } {
  const emitted: string[] = [];
  return {
    emitted,
    write: (bytes) => {
      emitted.push(bytes);
    },
  };
}

describe("yankToClipboard (issue #326)", () => {
  it("emits ESC ] 52 ; c ; <base64> BEL with no trailing newline", () => {
    const sink = captureSink();
    yankToClipboard("src/main.ts", sink);
    expect(sink.emitted).toHaveLength(1);
    const out = sink.emitted[0];
    // ESC = \x1b, BEL = \x07. The terminator is BEL, not ST (\x1b\\).
    expect(out.startsWith("\x1b]52;c;")).toBe(true);
    expect(out.endsWith("\x07")).toBe(true);
    expect(out.endsWith("\n")).toBe(false);
  });

  it("base64-encodes the payload between the prefix and BEL", () => {
    const sink = captureSink();
    yankToClipboard("src/main.ts", sink);
    const payload = sink.emitted[0].slice("\x1b]52;c;".length, -1);
    const decoded = Buffer.from(payload, "base64").toString("utf-8");
    expect(decoded).toBe("src/main.ts");
  });

  it("round-trips unicode paths through base64", () => {
    const sink = captureSink();
    yankToClipboard("docs/héllo.md", sink);
    const payload = sink.emitted[0].slice("\x1b]52;c;".length, -1);
    expect(Buffer.from(payload, "base64").toString("utf-8")).toBe("docs/héllo.md");
  });

  it("round-trips an empty string (no precondition guard in the wire)", () => {
    const sink = captureSink();
    yankToClipboard("", sink);
    expect(sink.emitted[0]).toBe("\x1b]52;c;\x07");
  });

  // A single write keeps the OSC sequence atomic — partial flushes could
  // interleave with concurrent stdout traffic and corrupt the payload at
  // the host terminal.
  it("writes the entire sequence in a single sink call (atomic emission)", () => {
    const sink = captureSink();
    yankToClipboard("a/b/c.txt", sink);
    expect(sink.emitted).toHaveLength(1);
  });
});
