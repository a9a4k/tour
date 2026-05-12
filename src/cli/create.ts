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
  // WIP anchors on HEAD (tip = parent = HEAD); resolveDefaultBase's
  // strict-between check still picks merge-base when the branch is
  // multi-commit ahead of upstream. Issue #201.
  const tipRef = isWip ? "HEAD" : head;
  const parentRef = isWip ? "HEAD" : head + "^";

  const headSha = isWip
    ? await snapshotWorkingTree(id, cwd)
    : await resolveRef(head, cwd);

  const base = args.base
    ? { sha: await resolveRef(args.base, cwd), source: args.base }
    : await resolveDefaultBase(tipRef, parentRef, cwd);

  const tour: Tour = {
    id,
    title: title ?? "",
    status: "open",
    created_at: new Date().toISOString(),
    closed_at: "",
    head_sha: headSha,
    base_sha: base.sha,
    head_source: head,
    base_source: base.source,
    wip_snapshot: isWip,
  };

  await createTour(cwd, tour);

  if (json) {
    printOutput(tour, true);
  } else {
    // stdout is the id alone so `TOUR_ID=$(tour create --head HEAD)` captures
    // it directly; the hint goes to stderr where it still reaches an
    // interactive TTY but stays out of `$()` substitution. (Issue #205)
    console.log(id);
    console.error(`Open with: tour tui ${id}`);
  }
}
