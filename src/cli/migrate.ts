import { existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml";
import { printOutput } from "./output.js";

interface MigrateArgs {
  json: boolean;
  cwd: string;
  tourStoreRoot: string;
  worktreeStamp: string;
  legacyDotTour?: string;
}

interface MigrateResult {
  migrated: string[];
  gitignoreScrubbed: boolean;
  removedDir: boolean;
}

async function legacyTourIds(legacyDotTour: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(legacyDotTour, { withFileTypes: true });
  } catch {
    return [];
  }

  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (existsSync(join(legacyDotTour, entry.name, "tour.toml"))) {
      ids.push(entry.name);
    }
  }
  return ids.sort();
}

async function stampTour(
  tourStoreRoot: string,
  id: string,
  worktreeStamp: string,
): Promise<void> {
  const tourTomlPath = join(tourStoreRoot, id, "tour.toml");
  const tour = parseTOML(await readFile(tourTomlPath, "utf-8")) as Record<
    string,
    unknown
  >;
  tour.created_in_worktree = worktreeStamp;
  await writeFile(tourTomlPath, stringifyTOML(tour));
}

async function scrubGitignore(repoRoot: string): Promise<boolean> {
  const gitignorePath = join(repoRoot, ".gitignore");
  let content: string;
  try {
    content = await readFile(gitignorePath, "utf-8");
  } catch {
    return false;
  }

  const hadFinalNewline = content.endsWith("\n");
  const lines = content.split(/\r?\n/);
  const kept = lines.filter((line, index) => {
    if (index === lines.length - 1 && line === "" && hadFinalNewline) return true;
    const trimmed = line.trim();
    return trimmed !== ".tour" && trimmed !== ".tour/";
  });

  if (kept.length === lines.length) return false;
  let next = kept.join("\n");
  if (hadFinalNewline && next !== "" && !next.endsWith("\n")) next += "\n";
  await writeFile(gitignorePath, next);
  return true;
}

async function removeIfEmpty(path: string): Promise<boolean> {
  try {
    await rmdir(path);
    return true;
  } catch {
    return false;
  }
}

function printMigrateResult(result: MigrateResult, json: boolean): void {
  const migratedCount = result.migrated.length;
  if (json) {
    printOutput(result, true);
  } else if (migratedCount === 0) {
    console.log("nothing to migrate");
  } else {
    console.log(
      `migrated ${migratedCount} tour${migratedCount === 1 ? "" : "s"}`,
    );
  }
}

export async function migrate(args: MigrateArgs): Promise<void> {
  const { cwd, json, legacyDotTour, tourStoreRoot, worktreeStamp } = args;
  if (!legacyDotTour) {
    const result: MigrateResult = {
      migrated: [],
      gitignoreScrubbed: false,
      removedDir: false,
    };
    printMigrateResult(result, json);
    return;
  }

  const ids = await legacyTourIds(legacyDotTour);
  for (const id of ids) {
    const destination = join(tourStoreRoot, id);
    if (existsSync(destination)) {
      throw new Error(`cannot migrate ${id}: ${destination} already exists`);
    }
  }

  await mkdir(tourStoreRoot, { recursive: true });
  const migrated: string[] = [];
  for (const id of ids) {
    const source = join(legacyDotTour, id);
    const destination = join(tourStoreRoot, id);
    await rename(source, destination);
    await stampTour(tourStoreRoot, id, worktreeStamp);
    migrated.push(id);
  }

  const gitignoreScrubbed = await scrubGitignore(cwd);
  const removedDir = await removeIfEmpty(legacyDotTour);
  const result: MigrateResult = { migrated, gitignoreScrubbed, removedDir };
  printMigrateResult(result, json);
}
