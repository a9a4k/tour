import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseTOML } from "smol-toml";
import { validateEditorTemplate } from "./editor-config.js";
import { validateReplyAgentTemplate } from "./reply-agent-template.js";
import { USER_CONFIG_SEED } from "./user-config-seed.js";

export interface UserConfig {
  replyAgent?: string;
  editor?: string;
  editorTerminal?: boolean;
}

const VALID_KEYS = ["reply_agent", "editor", "editor_terminal"] as const;

interface LoadUserConfigOptions {
  autoCreate?: boolean;
}

export type SeedUserConfigResult =
  | { status: "created"; configPath: string }
  | { status: "exists"; configPath: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function hasErrorCode(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === code
  );
}

async function writeSeedConfig(configPath: string, tourHome: string): Promise<void> {
  const tmpPath = join(tourHome, `.config.toml.${process.pid}.${randomUUID()}.tmp`);
  await mkdir(tourHome, { recursive: true });
  try {
    await writeFile(tmpPath, USER_CONFIG_SEED, { flag: "w" });
    await rename(tmpPath, configPath);
  } catch (err) {
    await rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}

export async function seedUserConfig(tourHome: string): Promise<SeedUserConfigResult> {
  const configPath = join(tourHome, "config.toml");
  try {
    await stat(configPath);
    return { status: "exists", configPath };
  } catch (err) {
    if (!hasErrorCode(err, "ENOENT")) {
      throw err;
    }
  }

  await writeSeedConfig(configPath, tourHome);
  return { status: "created", configPath };
}

export async function loadUserConfig(
  tourHome: string,
  opts: LoadUserConfigOptions = {},
): Promise<UserConfig> {
  const configPath = join(tourHome, "config.toml");
  let content: string;
  try {
    content = await readFile(configPath, "utf8");
  } catch (err) {
    if (hasErrorCode(err, "ENOENT")) {
      if (opts.autoCreate ?? true) {
        try {
          await seedUserConfig(tourHome);
        } catch (writeErr) {
          console.error(
            `could not write ${configPath} (${errorMessage(writeErr)}); continuing with empty config`,
          );
        }
      }
      return {};
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = parseTOML(content);
  } catch (err) {
    const message = errorMessage(err);
    throw new Error(`Malformed Tour config at ${configPath}: ${message}`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`Malformed Tour config at ${configPath}: expected root table`);
  }

  for (const key of Object.keys(parsed)) {
    if (!VALID_KEYS.includes(key as (typeof VALID_KEYS)[number])) {
      throw new Error(
        `Unknown Tour config key "${key}" in ${configPath}. Valid keys: ${VALID_KEYS.join(", ")}`,
      );
    }
  }

  const config: UserConfig = {};
  if (parsed.reply_agent !== undefined) {
    if (typeof parsed.reply_agent !== "string") {
      throw new Error(
        `Invalid Tour config key "reply_agent": expected string in ${configPath}`,
      );
    }
    validateReplyAgentTemplate(parsed.reply_agent, configPath);
    config.replyAgent = parsed.reply_agent;
  }
  if (parsed.editor !== undefined) {
    if (typeof parsed.editor !== "string") {
      throw new Error(
        `Invalid Tour config key "editor": expected string in ${configPath}`,
      );
    }
    validateEditorTemplate(parsed.editor, configPath);
    config.editor = parsed.editor;
  }
  if (parsed.editor_terminal !== undefined) {
    if (typeof parsed.editor_terminal !== "boolean") {
      throw new Error(
        `Invalid Tour config key "editor_terminal": expected boolean in ${configPath}`,
      );
    }
    config.editorTerminal = parsed.editor_terminal;
  }
  return config;
}
