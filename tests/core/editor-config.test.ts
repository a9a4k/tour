import { describe, it, expect } from "vitest";
import { resolveEditor } from "../../src/core/editor-config.js";

// Pure editor-config resolver (PRD #466 / issue #468).
// Asserts the precedence chain (`--editor` > `$TOUR_EDITOR` > Tour config
// > `$VISUAL` > `$EDITOR` > null), template-only argv rendering, and
// user-declared terminal-editor classification.

describe("resolveEditor — precedence", () => {
  const flagTemplate = "code -g {file}:{line}";
  const tourEditorTemplate = "cursor -g {file}:{line}";
  const configTemplate = "idea --line {line} {file}";
  const visualTemplate = "vim +{line} {file}";
  const editorTemplate = "nvim +{line} {file}";

  it("flag wins over every env var", () => {
    const cfg = resolveEditor(flagTemplate, {
      TOUR_EDITOR: tourEditorTemplate,
      VISUAL: visualTemplate,
      EDITOR: editorTemplate,
    });
    expect(cfg?.bin).toBe("code");
    expect(cfg?.template).toBe(flagTemplate);
  });

  it("$TOUR_EDITOR wins over $VISUAL and $EDITOR when no flag", () => {
    const cfg = resolveEditor(undefined, {
      TOUR_EDITOR: tourEditorTemplate,
      VISUAL: visualTemplate,
      EDITOR: editorTemplate,
    });
    expect(cfg?.bin).toBe("cursor");
  });

  it("$TOUR_EDITOR wins over config when no flag", () => {
    const cfg = resolveEditor(
      undefined,
      { TOUR_EDITOR: tourEditorTemplate },
      { editor: configTemplate },
    );
    expect(cfg?.bin).toBe("cursor");
  });

  it("config wins over $VISUAL and $EDITOR when no flag and no TOUR_EDITOR", () => {
    const cfg = resolveEditor(
      undefined,
      {
        VISUAL: visualTemplate,
        EDITOR: editorTemplate,
      },
      { editor: configTemplate },
    );
    expect(cfg?.bin).toBe("idea");
  });

  it("flag wins over config", () => {
    const cfg = resolveEditor(flagTemplate, {}, { editor: configTemplate });
    expect(cfg?.bin).toBe("code");
  });

  it("$VISUAL wins over $EDITOR when no flag and no TOUR_EDITOR", () => {
    const cfg = resolveEditor(undefined, {
      VISUAL: visualTemplate,
      EDITOR: editorTemplate,
    });
    expect(cfg?.bin).toBe("vim");
  });

  it("$EDITOR is the lowest-priority fallback", () => {
    const cfg = resolveEditor(undefined, { EDITOR: editorTemplate });
    expect(cfg?.bin).toBe("nvim");
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
      EDITOR: editorTemplate,
    });
    expect(cfg?.bin).toBe("nvim");
  });
});

describe("resolveEditor — template substitution", () => {
  it("rejects editor values that omit {file}", () => {
    expect(() => resolveEditor("code", {})).toThrow(
      /Editor template must include \{file\}/,
    );
  });

  it("substitutes {file} and {line} placeholders verbatim", () => {
    const cfg = resolveEditor("myedit --new-window {file}:{line}", {});
    expect(cfg).not.toBeNull();
    const argv = cfg!.argv("/abs/path/foo.ts", 42);
    expect(argv).toEqual(["--new-window", "/abs/path/foo.ts:42"]);
  });

  it("substitutes {workspace} in explicit templates", () => {
    const cfg = resolveEditor(
      "code {workspace} -g {file}:{line}",
      {},
      undefined,
      "/repo/worktree",
    );
    expect(cfg!.argv("/repo/worktree/src/app.ts", 42)).toEqual([
      "/repo/worktree",
      "-g",
      "/repo/worktree/src/app.ts:42",
    ]);
  });

  it("leaves {workspace} literal when repoRoot is omitted", () => {
    const cfg = resolveEditor("code {workspace} -g {file}:{line}", {});
    expect(cfg!.argv("/repo/worktree/src/app.ts", 42)).toEqual([
      "{workspace}",
      "-g",
      "/repo/worktree/src/app.ts:42",
    ]);
  });

  it("substitutes {workspace} from every editor chain layer", () => {
    const raw = "code {workspace} -g {file}:{line}";
    const file = "/repo/worktree/src/app.ts";
    const cases: Array<{
      name: string;
      flag?: string;
      env: Parameters<typeof resolveEditor>[1];
      config?: Parameters<typeof resolveEditor>[2];
    }> = [
      {
        name: "flag",
        flag: raw,
        env: { TOUR_EDITOR: "vim +{line} {file}" },
        config: { editor: "nano {file}" },
      },
      {
        name: "$TOUR_EDITOR",
        env: { TOUR_EDITOR: raw },
        config: { editor: "nano {file}" },
      },
      {
        name: "config",
        env: { VISUAL: "vim +{line} {file}" },
        config: { editor: raw },
      },
      { name: "$VISUAL", env: { VISUAL: raw, EDITOR: "vim +{line} {file}" } },
      { name: "$EDITOR", env: { EDITOR: raw } },
    ];

    for (const c of cases) {
      const cfg = resolveEditor(c.flag, c.env, c.config, "/repo/worktree");
      expect(cfg!.argv(file, 42), c.name).toEqual([
        "/repo/worktree",
        "-g",
        `${file}:42`,
      ]);
    }
  });

  it("template with only {file} (no {line}) substitutes file only", () => {
    const cfg = resolveEditor("myedit {file}", {});
    expect(cfg!.argv("/p/x.ts", 7)).toEqual(["/p/x.ts"]);
  });

  it("bin is the first word of the template", () => {
    const cfg = resolveEditor("myedit --new-window {file}:{line}", {});
    expect(cfg!.bin).toBe("myedit");
  });
});

describe("resolveEditor — terminal-editor classification", () => {
  it("defaults to non-terminal", () => {
    expect(resolveEditor("vim +{line} {file}", {})!.terminal).toBe(false);
  });

  it("reads terminal classification from config.editor_terminal", () => {
    const cfg = resolveEditor(undefined, {}, {
      editor: "my-vim-wrapper.sh +{line} {file}",
      editorTerminal: true,
    });
    expect(cfg!.terminal).toBe(true);
  });

  it("does not infer terminal classification from the selected binary basename", () => {
    expect(resolveEditor("vim +{line} {file}", {})!.terminal).toBe(false);
    expect(resolveEditor("/usr/bin/vim +{line} {file}", {})!.terminal).toBe(
      false,
    );
  });

  it("keeps editor_terminal config-sourced even when the editor template comes from a flag", () => {
    const cfg = resolveEditor("code -g {file}:{line}", {}, {
      editor: "vim +{line} {file}",
      editorTerminal: true,
    });
    expect(cfg!.bin).toBe("code");
    expect(cfg!.terminal).toBe(true);
  });
});
