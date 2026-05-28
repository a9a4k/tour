import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseTOML } from "smol-toml";
import { validateEditorTemplate } from "./editor-config.js";
import { validateReplyAgentTemplate } from "./reply-agent-template.js";

export interface UserConfig {
  replyAgent?: string;
  editor?: string;
  editorTerminal?: boolean;
}

const VALID_KEYS = ["reply_agent", "editor", "editor_terminal"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function loadUserConfig(tourHome: string): Promise<UserConfig> {
  const configPath = join(tourHome, "config.toml");
  let content: string;
  try {
    content = await readFile(configPath, "utf8");
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      err.code === "ENOENT"
    ) {
      return {};
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = parseTOML(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
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
