import { describe, it, expect } from "vitest";
import { parseBatch } from "../../src/cli/parse-batch.js";

describe("parseBatch", () => {
  it("parses a single-line JSONL document", () => {
    const stdin = `{"file":"a","side":"additions","line":"1","body":"x"}\n`;
    const items = parseBatch(stdin);
    expect(items).toEqual([
      { file: "a", side: "additions", line: "1", body: "x" },
    ]);
  });

  it("parses multi-line JSONL with mixed anchor shapes", () => {
    const stdin =
      `{"file":"a","side":"additions","line":"1","body":"x"}\n` +
      `{"file":"b","side":"deletions","line_start":12,"line_end":14,"body":"y"}\n` +
      `{"file":"c","side":"additions","line_start":40,"body":"z"}\n`;
    const items = parseBatch(stdin);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ line: "1" });
    expect(items[1]).toMatchObject({ line_start: 12, line_end: 14 });
    expect(items[2]).toMatchObject({ line_start: 40 });
    expect(items[2].line_end).toBeUndefined();
  });

  it("tolerates blank lines in JSONL", () => {
    const stdin =
      `\n` +
      `{"file":"a","side":"additions","line":"1","body":"x"}\n` +
      `\n` +
      `{"file":"b","side":"additions","line":"2","body":"y"}\n` +
      `\n`;
    const items = parseBatch(stdin);
    expect(items).toHaveLength(2);
  });

  it("parses a JSON array (back-compat)", () => {
    const stdin = JSON.stringify([
      { file: "a", side: "additions", line: "1", body: "x" },
      { file: "b", side: "additions", line: "2", body: "y" },
    ]);
    const items = parseBatch(stdin);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ file: "a" });
  });

  it("tolerates leading whitespace before JSON-array detection", () => {
    const stdin = `  \n[{"file":"a","side":"additions","line":"1","body":"x"}]\n`;
    const items = parseBatch(stdin);
    expect(items).toHaveLength(1);
  });

  it("reports the offending line number on JSONL parse failure", () => {
    const stdin =
      `{"file":"a","side":"additions","line":"1","body":"x"}\n` +
      `{not valid json}\n`;
    expect(() => parseBatch(stdin)).toThrow(/Line 2:/);
  });

  it("reports the line number relative to the original input (counting blanks)", () => {
    const stdin =
      `\n` +
      `{"file":"a","side":"additions","line":"1","body":"x"}\n` +
      `\n` +
      `{broken}\n`;
    expect(() => parseBatch(stdin)).toThrow(/Line 4:/);
  });

  it("returns [] on empty input", () => {
    expect(parseBatch("")).toEqual([]);
    expect(parseBatch("   \n\n")).toEqual([]);
  });

  it("rejects a non-array JSON document that starts with [", () => {
    // JSON parse error from non-JSON input that happens to start with [
    expect(() => parseBatch("[not json")).toThrow();
  });

  it("supports thread_id in JSONL", () => {
    const stdin = `{"thread_id":"ann-id","body":"thx"}\n`;
    const items = parseBatch(stdin);
    expect(items).toEqual([{ thread_id: "ann-id", body: "thx" }]);
  });
});
