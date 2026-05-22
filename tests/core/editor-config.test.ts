import { describe, it, expect } from "vitest";
import { resolveEditor } from "../../src/core/editor-config.js";

// Pure editor-config resolver (PRD #349 / ADR 0032 / issue #352).
// Asserts the precedence chain (`--editor` > `$TOUR_EDITOR` > `$VISUAL`
// > `$EDITOR` > null), the template substitution semantics, the smart-
// default inference table by binary basename, and the terminal-editor
// classification. Pure-function input — caller passes `env`, no
// process.env reads here.

describe("resolveEditor — precedence", () => {
  it("flag wins over every env var", () => {
    const cfg = resolveEditor("code -g", {
      TOUR_EDITOR: "vim",
      VISUAL: "emacs",
      EDITOR: "nano",
    });
    expect(cfg?.bin).toBe("code");
  });

  it("$TOUR_EDITOR wins over $VISUAL and $EDITOR when no flag", () => {
    const cfg = resolveEditor(undefined, {
      TOUR_EDITOR: "code",
      VISUAL: "vim",
      EDITOR: "nano",
    });
    expect(cfg?.bin).toBe("code");
  });

  it("$TOUR_EDITOR wins over config when no flag", () => {
    const cfg = resolveEditor(
      undefined,
      { TOUR_EDITOR: "code" },
      "vim",
    );
    expect(cfg?.bin).toBe("code");
  });

  it("config wins over $VISUAL and $EDITOR when no flag and no TOUR_EDITOR", () => {
    const cfg = resolveEditor(
      undefined,
      {
        VISUAL: "vim",
        EDITOR: "nano",
      },
      "code",
    );
    expect(cfg?.bin).toBe("code");
  });

  it("flag wins over config", () => {
    const cfg = resolveEditor("code", {}, "vim");
    expect(cfg?.bin).toBe("code");
  });

  it("$VISUAL wins over $EDITOR when no flag and no TOUR_EDITOR", () => {
    const cfg = resolveEditor(undefined, {
      VISUAL: "code",
      EDITOR: "vim",
    });
    expect(cfg?.bin).toBe("code");
  });

  it("$EDITOR is the lowest-priority fallback", () => {
    const cfg = resolveEditor(undefined, { EDITOR: "code" });
    expect(cfg?.bin).toBe("code");
  });

  it("returns null when no flag and no env vars are set", () => {
    expect(resolveEditor(undefined, {})).toBeNull();
  });

  it("returns null when config is absent and no env vars are set", () => {
    expect(resolveEditor(undefined, {}, undefined)).toBeNull();
  });

  it("returns null when flag is empty string and env is empty", () => {
    expect(resolveEditor("", {})).toBeNull();
  });

  it("falls through empty string envs to the next slot", () => {
    const cfg = resolveEditor(undefined, {
      TOUR_EDITOR: "",
      VISUAL: "",
      EDITOR: "code",
    });
    expect(cfg?.bin).toBe("code");
  });
});

describe("resolveEditor — template substitution", () => {
  it("substitutes {file} and {line} placeholders verbatim", () => {
    const cfg = resolveEditor("myedit --new-window {file}:{line}", {});
    expect(cfg).not.toBeNull();
    const argv = cfg!.argv("/abs/path/foo.ts", 42);
    expect(argv).toEqual(["--new-window", "/abs/path/foo.ts:42"]);
  });

  it("template with only {file} (no {line}) substitutes file only", () => {
    const cfg = resolveEditor("myedit {file}", {});
    expect(cfg!.argv("/p/x.ts", 7)).toEqual(["/p/x.ts"]);
  });

  it("template with only {line} (no {file}) substitutes line only", () => {
    const cfg = resolveEditor("myedit +{line}", {});
    expect(cfg!.argv("/p/x.ts", 7)).toEqual(["+7"]);
  });

  it("bin is the first word of the template", () => {
    const cfg = resolveEditor("myedit --new-window {file}:{line}", {});
    expect(cfg!.bin).toBe("myedit");
  });
});

describe("resolveEditor — smart-default inference by basename", () => {
  it("code → -g {file}:{line}", () => {
    const cfg = resolveEditor("code", {});
    expect(cfg!.argv("/p/x.ts", 7)).toEqual(["-g", "/p/x.ts:7"]);
  });

  it("cursor → -g {file}:{line}", () => {
    const cfg = resolveEditor("cursor", {});
    expect(cfg!.argv("/p/x.ts", 7)).toEqual(["-g", "/p/x.ts:7"]);
  });

  it("codium → -g {file}:{line}", () => {
    const cfg = resolveEditor("codium", {});
    expect(cfg!.argv("/p/x.ts", 7)).toEqual(["-g", "/p/x.ts:7"]);
  });

  it("idea → --line {line} {file}", () => {
    const cfg = resolveEditor("idea", {});
    expect(cfg!.argv("/p/x.ts", 7)).toEqual(["--line", "7", "/p/x.ts"]);
  });

  it("webstorm → --line {line} {file}", () => {
    const cfg = resolveEditor("webstorm", {});
    expect(cfg!.argv("/p/x.ts", 7)).toEqual(["--line", "7", "/p/x.ts"]);
  });

  it("pycharm → --line {line} {file}", () => {
    const cfg = resolveEditor("pycharm", {});
    expect(cfg!.argv("/p/x.ts", 7)).toEqual(["--line", "7", "/p/x.ts"]);
  });

  it("rubymine / clion / goland / phpstorm → --line {line} {file}", () => {
    for (const bin of ["rubymine", "clion", "goland", "phpstorm"]) {
      const cfg = resolveEditor(bin, {});
      expect(cfg!.argv("/p/x.ts", 7)).toEqual(["--line", "7", "/p/x.ts"]);
    }
  });

  it("vim / nvim / nano / emacs / hx / vi / micro → +{line} {file}", () => {
    for (const bin of ["vim", "nvim", "nano", "emacs", "hx", "vi", "micro"]) {
      const cfg = resolveEditor(bin, {});
      expect(cfg!.argv("/p/x.ts", 7)).toEqual(["+7", "/p/x.ts"]);
    }
  });

  it("unknown binary → {file}:{line} (works for subl, gedit, kate)", () => {
    const cfg = resolveEditor("subl", {});
    expect(cfg!.argv("/p/x.ts", 7)).toEqual(["/p/x.ts:7"]);
  });

  it("smart-default uses the binary basename even with absolute paths", () => {
    const cfg = resolveEditor("/usr/local/bin/code", {});
    expect(cfg!.argv("/p/x.ts", 7)).toEqual(["-g", "/p/x.ts:7"]);
    expect(cfg!.bin).toBe("/usr/local/bin/code");
  });

  it("flag with smart-default + extra args appends inferred suffix after the args", () => {
    // A bare-binary form with no placeholders is the smart-default path —
    // extra trailing args in the configured command are kept and the
    // inferred (file, line) suffix is appended.
    const cfg = resolveEditor("code --wait", {});
    expect(cfg!.argv("/p/x.ts", 7)).toEqual(["--wait", "-g", "/p/x.ts:7"]);
  });
});

describe("resolveEditor — terminal-editor classification", () => {
  it("classifies vim / nvim / vi / nano / emacs / hx / micro as terminal", () => {
    for (const bin of ["vim", "nvim", "vi", "nano", "emacs", "hx", "micro"]) {
      expect(resolveEditor(bin, {})!.terminal).toBe(true);
    }
  });

  it("classifies code / cursor / codium / idea family / subl as GUI", () => {
    for (const bin of [
      "code",
      "cursor",
      "codium",
      "idea",
      "webstorm",
      "pycharm",
      "rubymine",
      "clion",
      "goland",
      "phpstorm",
      "subl",
      "gedit",
    ]) {
      expect(resolveEditor(bin, {})!.terminal).toBe(false);
    }
  });

  it("terminal classification uses basename, not the absolute path", () => {
    expect(resolveEditor("/usr/bin/vim", {})!.terminal).toBe(true);
    expect(resolveEditor("/usr/local/bin/code", {})!.terminal).toBe(false);
  });

  it("template-form retains classification of the first-word binary", () => {
    expect(resolveEditor("vim +{line} {file}", {})!.terminal).toBe(true);
    expect(resolveEditor("code -g {file}:{line}", {})!.terminal).toBe(false);
  });
});
