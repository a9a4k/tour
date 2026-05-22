import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadUserConfig, type UserConfig } from "../core/user-config.js";

type ConfigSource = "config" | "$TOUR_EDITOR" | "$VISUAL" | "$EDITOR" | "default";

interface ResolvedConfigValue {
  value: string | null;
  source: ConfigSource;
}

interface ConfigEnv {
  TOUR_EDITOR?: string;
  VISUAL?: string;
  EDITOR?: string;
}

function firstNonEmptyWithSource(
  ...candidates: Array<{ value: string | undefined; source: ConfigSource }>
): ResolvedConfigValue {
  for (const c of candidates) {
    if (c.value !== undefined && c.value !== "") {
      return { value: c.value, source: c.source };
    }
  }
  return { value: null, source: "default" };
}

function renderValue(value: string | null): string {
  return value === null ? "null" : JSON.stringify(value);
}

function resolveReplyAgent(config: UserConfig): ResolvedConfigValue {
  return firstNonEmptyWithSource({
    value: config.replyAgent,
    source: "config",
  });
}

function resolveEditor(config: UserConfig, env: ConfigEnv): ResolvedConfigValue {
  return firstNonEmptyWithSource(
    { value: env.TOUR_EDITOR, source: "$TOUR_EDITOR" },
    { value: config.editor, source: "config" },
    { value: env.VISUAL, source: "$VISUAL" },
    { value: env.EDITOR, source: "$EDITOR" },
  );
}

export async function configShow(
  tourHomePath: string,
  env: ConfigEnv = process.env,
): Promise<void> {
  const configPath = join(tourHomePath, "config.toml");
  let config: UserConfig = {};
  let fileStatus: string;

  try {
    config = await loadUserConfig(tourHomePath);
    fileStatus = existsSync(configPath) ? "exists" : "does not exist";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fileStatus = `UNREADABLE: ${message}`;
  }

  const replyAgent = resolveReplyAgent(config);
  const editor = resolveEditor(config, env);

  console.log(`Config file: ${configPath} (${fileStatus})

reply_agent = ${renderValue(replyAgent.value)} (from ${replyAgent.source})
editor      = ${renderValue(editor.value)} (from ${editor.source})`);
}
