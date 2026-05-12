import { resolveRef, resolveDefaultBase, snapshotWorkingTree } from "../core/git.js";
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
  let baseSource: string;

  if (isWip) {
    headSha = await snapshotWorkingTree(id, cwd);
    if (args.base) {
      baseSha = await resolveRef(args.base, cwd);
      baseSource = args.base;
    } else {
      // WIP anchors on HEAD: probe HEAD's upstream, merge-base when the
      // branch is multi-commit, else HEAD. Issue #201.
      const resolved = await resolveDefaultBase("HEAD", "HEAD", cwd);
      baseSha = resolved.sha;
      baseSource = resolved.source;
    }
  } else {
    headSha = await resolveRef(head, cwd);
    if (args.base) {
      baseSha = await resolveRef(args.base, cwd);
      baseSource = args.base;
    } else {
      // Probe <head>@{upstream}, merge-base when the branch is multi-
      // commit ahead of upstream, else <head>^. Issue #201.
      const resolved = await resolveDefaultBase(head, head + "^", cwd);
      baseSha = resolved.sha;
      baseSource = resolved.source;
    }
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
    base_source: baseSource,
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
