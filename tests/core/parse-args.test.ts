import { describe, it, expect } from "vitest";
import { parseArgs } from "../../src/core/parse-args.js";

// Pure CLI flag scanner. Single point of truth for argv → {command,
// positional, flags}. Issue #393 added the `--flag=value` form alongside
// the original `--flag value` form, and made `--flag=` (empty value) a
// startup error instead of a silent fall-through. The downstream
// `flag(flags, "name")` / `boolFlag(flags, "name")` readers in main.ts
// don't change — both forms round-trip through the same `flags` map.
describe("parseArgs", () => {
  // argv as Node hands it to us: [node, script, ...userArgs]. The
  // helper drops the first two entries internally.
  const argv = (...userArgs: string[]) => ["node", "tour", ...userArgs];

  describe("--flag value form (legacy, unchanged)", () => {
    it("treats next non-flag token as the value", () => {
      const r = parseArgs(argv("tui", "--reply-agent", "claude"));
      expect(r.flags["reply-agent"]).toBe("claude");
    });

    it("treats bare flag (no next token) as boolean true", () => {
      const r = parseArgs(argv("serve", "--open"));
      expect(r.flags["open"]).toBe(true);
    });

    it("treats flag followed by another --flag as boolean true", () => {
      const r = parseArgs(argv("serve", "--open", "--json"));
      expect(r.flags["open"]).toBe(true);
      expect(r.flags["json"]).toBe(true);
    });

    it("accepts negative-number values like --line -5", () => {
      const r = parseArgs(argv("comment", "x", "--line", "-5"));
      expect(r.flags["line"]).toBe("-5");
    });
  });

  describe("--flag=value form (issue #393)", () => {
    it("accepts --reply-agent=claude as a string flag", () => {
      const r = parseArgs(argv("tui", "--reply-agent=claude"));
      expect(r.command).toBe("tui");
      expect(r.flags["reply-agent"]).toBe("claude");
    });

    it("does NOT leak the `key=value` token as a phantom boolean flag", () => {
      // The pre-fix bug: parseArgs stored flags["reply-agent=claude"] = true
      // and left flags["reply-agent"] unset.
      const r = parseArgs(argv("tui", "--reply-agent=claude"));
      expect("reply-agent=claude" in r.flags).toBe(false);
    });

    it("accepts --editor=nvim as a string flag", () => {
      const r = parseArgs(argv("tui", "--editor=nvim"));
      expect(r.flags["editor"]).toBe("nvim");
    });

    it("accepts --port=9999 alongside a bare boolean --open", () => {
      const r = parseArgs(argv("serve", "--port=9999", "--open"));
      expect(r.flags["port"]).toBe("9999");
      expect(r.flags["open"]).toBe(true);
    });

    it("accepts all the comment flags in =value form", () => {
      const r = parseArgs(
        argv(
          "comment",
          "tour-id",
          "--file=hello.txt",
          "--side=additions",
          "--line=5",
          "--body=hi",
        ),
      );
      expect(r.command).toBe("comment");
      expect(r.positional).toEqual(["tour-id"]);
      expect(r.flags["file"]).toBe("hello.txt");
      expect(r.flags["side"]).toBe("additions");
      expect(r.flags["line"]).toBe("5");
      expect(r.flags["body"]).toBe("hi");
    });

    it("mixes --flag=value with --flag value in the same invocation", () => {
      const r = parseArgs(argv("tui", "--reply-agent=claude", "--editor", "nvim"));
      expect(r.flags["reply-agent"]).toBe("claude");
      expect(r.flags["editor"]).toBe("nvim");
    });

    it("only splits on the first =; further = stay in the value", () => {
      const r = parseArgs(argv("comment", "x", "--body=a=b=c"));
      expect(r.flags["body"]).toBe("a=b=c");
    });

    it("coerces --flag=true to boolean true", () => {
      const r = parseArgs(argv("serve", "--open=true"));
      expect(r.flags["open"]).toBe(true);
    });

    it("coerces --flag=false to boolean false", () => {
      const r = parseArgs(argv("serve", "--open=false"));
      expect(r.flags["open"]).toBe(false);
    });

    it("errors on --flag= (empty value after =)", () => {
      expect(() => parseArgs(argv("tui", "--reply-agent="))).toThrow(
        /missing value for `--reply-agent`/i,
      );
    });

    it("error message names the offending flag and mentions both forms", () => {
      try {
        parseArgs(argv("comment", "x", "--body="));
        throw new Error("should have thrown");
      } catch (err) {
        const message = (err as Error).message;
        expect(message).toMatch(/--body/);
        expect(message).toMatch(/missing value/i);
      }
    });

    it("works as the first arg (bare invocation), not just after a command", () => {
      // `tour --reply-agent=claude` (no subcommand) treats the flag as
      // bare-invocation argv. The first token starts with `-`, so the
      // command is "" and the flag iteration starts at index 0.
      const r = parseArgs(argv("--reply-agent=claude"));
      expect(r.command).toBe("");
      expect(r.flags["reply-agent"]).toBe("claude");
    });
  });

  describe("command and positional parsing", () => {
    it("uses the first non-flag token as the command", () => {
      const r = parseArgs(argv("list", "--json"));
      expect(r.command).toBe("list");
      expect(r.flags["json"]).toBe(true);
    });

    it("collects non-flag tokens after the command as positional", () => {
      const r = parseArgs(argv("show", "abc123"));
      expect(r.command).toBe("show");
      expect(r.positional).toEqual(["abc123"]);
    });

    it("treats a leading flag as bare invocation (empty command)", () => {
      const r = parseArgs(argv("--editor", "nvim"));
      expect(r.command).toBe("");
      expect(r.flags["editor"]).toBe("nvim");
    });

    it("keeps --help / -h / --version / -v as the command name", () => {
      expect(parseArgs(argv("--help")).command).toBe("--help");
      expect(parseArgs(argv("-h")).command).toBe("-h");
      expect(parseArgs(argv("--version")).command).toBe("--version");
      expect(parseArgs(argv("-v")).command).toBe("-v");
    });
  });
});
