import { describe, expect, it, vi } from "vitest";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadUserConfig } from "../../src/core/user-config.js";
import { USER_CONFIG_SEED } from "../../src/core/user-config-seed.js";

async function tempTourHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "tour-user-config-"));
}

describe("loadUserConfig", () => {
  it("loads both supported keys from config.toml", async () => {
    const tourHome = await tempTourHome();
    await writeFile(
      join(tourHome, "config.toml"),
      'reply_agent = "claude --print {userPrompt}"\neditor = "code -g {file}:{line}"\neditor_terminal = true\n',
    );

    await expect(loadUserConfig(tourHome)).resolves.toEqual({
      replyAgent: "claude --print {userPrompt}",
      editor: "code -g {file}:{line}",
      editorTerminal: true,
    });
  });

  it("writes the seed file and returns an empty config when config.toml is missing", async () => {
    const tourHome = await tempTourHome();
    const configPath = join(tourHome, "config.toml");

    await expect(loadUserConfig(tourHome)).resolves.toEqual({});
    await expect(readFile(configPath, "utf8")).resolves.toBe(USER_CONFIG_SEED);
  });

  it("returns an empty config without writing when auto-create is disabled", async () => {
    const tourHome = await tempTourHome();
    const configPath = join(tourHome, "config.toml");

    await expect(loadUserConfig(tourHome, { autoCreate: false })).resolves.toEqual({});
    await expect(readFile(configPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("does not overwrite an existing config.toml", async () => {
    const tourHome = await tempTourHome();
    const configPath = join(tourHome, "config.toml");
    const content =
      '# my comments stay here\neditor = "code -g {file}:{line}"\n\nreply_agent = "codex exec {combinedPrompt}"\n';
    await writeFile(configPath, content);

    await expect(loadUserConfig(tourHome)).resolves.toEqual({
      editor: "code -g {file}:{line}",
      replyAgent: "codex exec {combinedPrompt}",
    });
    await expect(readFile(configPath, "utf8")).resolves.toBe(content);
  });

  it("warns and returns an empty config when the seed write fails", async () => {
    const tourHome = await tempTourHome();
    const configPath = join(tourHome, "config.toml");
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    await chmod(tourHome, 0o500);

    try {
      await expect(loadUserConfig(tourHome, { autoCreate: true })).resolves.toEqual({});
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(`could not write ${configPath}`),
      );
      expect(warn.mock.calls[0]?.[0]).toContain("continuing with empty config");
    } finally {
      await chmod(tourHome, 0o700);
      warn.mockRestore();
    }
  });

  it("leaves a complete seed file after concurrent first loads", async () => {
    const tourHome = await tempTourHome();
    const configPath = join(tourHome, "config.toml");

    await expect(
      Promise.all([
        loadUserConfig(tourHome, { autoCreate: true }),
        loadUserConfig(tourHome, { autoCreate: true }),
      ]),
    ).resolves.toEqual([{}, {}]);
    await expect(readFile(configPath, "utf8")).resolves.toBe(USER_CONFIG_SEED);
  });

  it("returns an empty config for an empty config.toml", async () => {
    const tourHome = await tempTourHome();
    await writeFile(join(tourHome, "config.toml"), "");

    await expect(loadUserConfig(tourHome)).resolves.toEqual({});
  });

  it("loads reply_agent without editor", async () => {
    const tourHome = await tempTourHome();
    await writeFile(join(tourHome, "config.toml"), 'reply_agent = "codex exec {combinedPrompt}"\n');

    await expect(loadUserConfig(tourHome)).resolves.toEqual({
      replyAgent: "codex exec {combinedPrompt}",
    });
  });

  it("loads editor without reply_agent", async () => {
    const tourHome = await tempTourHome();
    await writeFile(join(tourHome, "config.toml"), 'editor = "nvim {file}"\n');

    await expect(loadUserConfig(tourHome)).resolves.toEqual({
      editor: "nvim {file}",
    });
  });

  it("throws with the config path and examples when editor omits {file}", async () => {
    const tourHome = await tempTourHome();
    const configPath = join(tourHome, "config.toml");
    await writeFile(configPath, 'editor = "code"\n');

    await expect(loadUserConfig(tourHome)).rejects.toThrow(
      new RegExp(
        `Editor template in ${configPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*code.*\\{file\\} required.*code -g \\{file\\}:\\{line\\}.*cursor.*idea.*vim.*nvim`,
        "s",
      ),
    );
  });

  it("throws with the config path for malformed TOML", async () => {
    const tourHome = await tempTourHome();
    const configPath = join(tourHome, "config.toml");
    await writeFile(configPath, 'reply_agent = "claude\n');

    await expect(loadUserConfig(tourHome)).rejects.toThrow(configPath);
  });

  it("throws with the bad key and valid keys for unknown root keys", async () => {
    const tourHome = await tempTourHome();
    await writeFile(join(tourHome, "config.toml"), 'editorr = "code"\n');

    await expect(loadUserConfig(tourHome)).rejects.toThrow(
      /Unknown Tour config key "editorr".*reply_agent, editor, editor_terminal/,
    );
  });

  it("throws with the key, expected type, and config path for type mismatches", async () => {
    const tourHome = await tempTourHome();
    const configPath = join(tourHome, "config.toml");
    await writeFile(configPath, "reply_agent = 42\n");

    await expect(loadUserConfig(tourHome)).rejects.toThrow(
      new RegExp(`reply_agent.*expected string.*${configPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
  });

  it("throws with migration examples for bare-name reply_agent values", async () => {
    const tourHome = await tempTourHome();
    const configPath = join(tourHome, "config.toml");
    await writeFile(configPath, 'reply_agent = "claude"\n');

    await expect(loadUserConfig(tourHome)).rejects.toThrow(
      /Invalid reply_agent.*claude[\s\S]*Placeholders: \{systemPrompt\}, \{userPrompt\}, \{combinedPrompt\}[\s\S]*reply_agent = "claude --print/,
    );
  });

  it("throws with the unknown placeholder and valid placeholders for reply_agent typos", async () => {
    const tourHome = await tempTourHome();
    await writeFile(join(tourHome, "config.toml"), 'reply_agent = "claude --print {sytemPrompt}"\n');

    await expect(loadUserConfig(tourHome)).rejects.toThrow(
      /Unknown placeholder \{sytemPrompt\}.*\{systemPrompt\}.*\{userPrompt\}.*\{combinedPrompt\}/,
    );
  });
});
