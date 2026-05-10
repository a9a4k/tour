import { resolveIdPrefix } from "../core/tour-store.js";
import { readReplyLock, deleteReplyLock } from "../core/reply-lock.js";

interface ReplyCancelArgs {
  tourId: string;
  json: boolean;
  cwd: string;
}

export async function replyCancel(args: ReplyCancelArgs): Promise<void> {
  const resolvedId = await resolveIdPrefix(args.cwd, args.tourId);
  const lock = await readReplyLock(args.cwd, resolvedId);

  if (!lock) {
    if (args.json) {
      console.log(JSON.stringify({ cancelled: false, reason: "no-lock" }));
    } else {
      console.log(`No reply in flight for ${resolvedId}`);
    }
    return;
  }

  // Best-effort SIGKILL of the recorded pid. Race-safe: if the process has
  // already exited, kill() throws ESRCH which we swallow — cleanup of the
  // lockfile is the user-visible work and runs unconditionally.
  if (lock.pid > 0) {
    try {
      process.kill(lock.pid, "SIGKILL");
    } catch {
      // pid already gone; lockfile cleanup below is what matters.
    }
  }

  await deleteReplyLock(args.cwd, resolvedId);

  if (args.json) {
    console.log(
      JSON.stringify({
        cancelled: true,
        agent: lock.agent,
        responding_to: lock.responding_to,
        pid: lock.pid,
      }),
    );
  } else {
    console.log(
      `Cancelled ${lock.agent} reply for ${resolvedId} (pid ${lock.pid})`,
    );
  }
}
