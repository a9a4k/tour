import { resolveRef, resolveDefaultBase, snapshotWorkingTree } from "../core/git.js";
import { generateId } from "../core/ids.js";
import { ensureTourIgnored } from "../core/gitignore.js";
import { createTour, listTours } from "../core/tour-store.js";
import { readComments } from "../core/comments-store.js";
import { printOutput } from "./output.js";
import type { Tour } from "../core/types.js";

interface CreateArgs {
  head: string;
  base?: string;
  title?: string;
  force?: boolean;
  json: boolean;
  cwd: string;
}

export async function create(args: CreateArgs): Promise<void> {
  const { head, title, force, json, cwd } = args;

  await ensureTourIgnored(cwd);

  const isWip = head === "WIP";
  // WIP anchors on HEAD (tip = parent = HEAD); resolveDefaultBase's
  // strict-between check still picks merge-base when the branch is
  // multi-commit ahead of upstream. Issue #201.
  const tipRef = isWip ? "HEAD" : head;
  const parentRef = isWip ? "HEAD" : head + "^";

  // Non-WIP: resolve the head ref directly (no id needed yet). WIP: must
  // generate an id up-front so `snapshotWorkingTree` can stash the
  // working tree under `refs/tour/<id>`. WIP is also out of scope for
  // the duplicate-tour refusal — its head_sha is deterministic only
  // over the snapshot bytes, not over a ref, so two WIP creates aren't
  // duplicates even when the working tree is clean. (Issue #400.)
  let headSha: string;
  let wipId: string | undefined;
  if (isWip) {
    wipId = generateId();
    headSha = await snapshotWorkingTree(wipId, cwd);
  } else {
    headSha = await resolveRef(head, cwd);
  }

  const base = args.base
    ? { sha: await resolveRef(args.base, cwd), source: args.base }
    : await resolveDefaultBase(tipRef, parentRef, cwd);

  // Issue #400: refuse to create a parallel open tour over the same
  // `(head_sha, base_sha)`. The error block goes to stderr (so `$()`
  // capture stays clean); in `--json` mode we still emit the existing
  // tour's record to stdout (same envelope as `tour show <id> --json`)
  // for tooling. The non-zero exit is how callers discriminate "this is
  // the existing tour, not a freshly created one" from a normal create.
  // WIP is out of scope — see comment above.
  if (!isWip && !force) {
    const openTours = await listTours(cwd, { status: "open" });
    const existing = openTours.find(
      (t) => t.head_sha === headSha && t.base_sha === base.sha,
    );
    if (existing) {
      const head7 = existing.head_sha.slice(0, 7);
      const base7 = existing.base_sha.slice(0, 7);
      const lines = [
        `error: open tour ${existing.id} already covers this diff`,
        `  head_sha=${head7}  base_sha=${base7}`,
        `  resume:   tour tui ${existing.id}`,
        `  list:     tour list --status open`,
        `  override: tour create --head ${head} --force`,
      ];
      console.error(lines.join("\n"));
      if (json) {
        const comments = await readComments(cwd, existing.id);
        printOutput({ ...existing, comments }, true);
      }
      process.exitCode = 1;
      return;
    }
  }

  const id = isWip ? (wipId as string) : generateId();
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
