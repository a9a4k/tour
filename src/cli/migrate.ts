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
  const path = join(tourStoreRoot, id, "tour.toml");
  const tour = parseTOML(await readFile(path, "utf-8")) as Record<string, unknown>;
  tour.created_in_worktree = worktreeStamp;
  await writeFile(path, stringifyTOML(tour));
}

async function scrubGitignore(repoRoot: string): Promise<boolean> {
  const path = join(repoRoot, ".gitignore");
  let content: string;
  try {
    content = await readFile(path, "utf-8");
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
  await writeFile(path, next);
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

export async function migrate(args: MigrateArgs): Promise<void> {
  const legacyDotTour = args.legacyDotTour;
  if (!legacyDotTour) {
    const result = { migrated: [], gitignoreScrubbed: false, removedDir: false };
    if (args.json) printOutput(result, true);
    else console.log("nothing to migrate");
    return;
  }

  const ids = await legacyTourIds(legacyDotTour);
  for (const id of ids) {
    if (existsSync(join(args.tourStoreRoot, id))) {
      throw new Error(
        `cannot migrate ${id}: ${join(args.tourStoreRoot, id)} already exists`,
      );
    }
  }

  await mkdir(args.tourStoreRoot, { recursive: true });
  const migrated: string[] = [];
  for (const id of ids) {
    await rename(join(legacyDotTour, id), join(args.tourStoreRoot, id));
    await stampTour(args.tourStoreRoot, id, args.worktreeStamp);
    migrated.push(id);
  }

  const gitignoreScrubbed = await scrubGitignore(args.cwd);
  const removedDir = await removeIfEmpty(legacyDotTour);
  const result: MigrateResult = { migrated, gitignoreScrubbed, removedDir };

  if (args.json) {
    printOutput(result, true);
  } else if (migrated.length === 0) {
    console.log("nothing to migrate");
  } else {
    console.log(
      `migrated ${migrated.length} tour${migrated.length === 1 ? "" : "s"}`,
    );
  }
}
