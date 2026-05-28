import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadUserConfig } from "../../src/core/user-config.js";

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

  it("returns an empty config when config.toml is missing", async () => {
    const tourHome = await tempTourHome();

    await expect(loadUserConfig(tourHome)).resolves.toEqual({});
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
