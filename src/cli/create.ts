import { resolveRef, snapshotWorkingTree } from "../core/git.js";
import { generateId } from "../core/ids.js";
import { ensureTourIgnored } from "../core/gitignore.js";
import { createTour } from "../core/tour-store.js";
import { printOutput } from "./output.js";
import type { Tour } from "../core/types.js";

interface CreateArgs {
  head: string;
  base?: string;
  title?: string;
  json: boolean;
  cwd: string;
}

export async function create(args: CreateArgs): Promise<void> {
  const { head, title, json, cwd } = args;
  const id = generateId();

  await ensureTourIgnored(cwd);

  const isWip = head === "WIP";
  let headSha: string;
  let baseSha: string;

  if (isWip) {
    headSha = await snapshotWorkingTree(id, cwd);
    baseSha = args.base
      ? await resolveRef(args.base, cwd)
      : await resolveRef("HEAD", cwd);
  } else {
    headSha = await resolveRef(head, cwd);
    baseSha = args.base
      ? await resolveRef(args.base, cwd)
      : await resolveRef(head + "^", cwd);
  }

  const tour: Tour = {
    id,
    title: title ?? "",
    status: "open",
    created_at: new Date().toISOString(),
    closed_at: "",
    head_sha: headSha,
    base_sha: baseSha,
    head_source: head,
    base_source: args.base ?? "",
    wip_snapshot: isWip,
  };

  await createTour(cwd, tour);

  if (json) {
    printOutput(tour, true);
  } else {
    console.log(id);
    console.log(`Open with: tour tui ${id}`);
  }
}
