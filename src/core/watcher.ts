import { watch, existsSync, statSync, type FSWatcher } from "node:fs";
import { join } from "node:path";

export type WatchEvent =
  | { type: "comment-changed"; tourId: string }
  | { type: "reply-in-flight"; tourId: string }
  | { type: "reply-cleared"; tourId: string };

export type WatchCallback = (event: WatchEvent) => void;

const REPLY_LOCK_FILENAME = ".reply-lock.json";
// Stage B on-disk filename (issue #342 / PRD #335 / ADR 0029 addendum).
// `comments.jsonl` is the canonical name; `annotations.jsonl` is the
// permanent legacy fallback. The watcher fires on writes to whichever
// name the Tour folder uses — pre-Stage-B `.tour/` dirs keep working
// without an explicit migration step. The .jsonl extension match in
// `start()` covers both filenames; the fingerprint check below tracks
// whichever file the reader would currently read from.
const COMMENTS_FILENAME = "comments.jsonl";
const LEGACY_ANNOTATIONS_FILENAME = "annotations.jsonl";

interface FileFingerprint {
  mtimeMs: number;
  size: number;
}

function fingerprint(path: string): FileFingerprint | null {
  try {
    const s = statSync(path);
    return { mtimeMs: s.mtimeMs, size: s.size };
  } catch {
    return null;
  }
}

// Effective fingerprint mirrors the reader's fallback: prefer
// `comments.jsonl`, fall back to `annotations.jsonl`. A folder that gets
// migrated mid-watch transitions from the legacy fingerprint to the new
// one — the values won't match, so the watcher emits.
function effectiveCommentsFingerprint(dir: string): FileFingerprint | null {
  const newFp = fingerprint(join(dir, COMMENTS_FILENAME));
  if (newFp) return newFp;
  return fingerprint(join(dir, LEGACY_ANNOTATIONS_FILENAME));
}

function sameFingerprint(a: FileFingerprint | null, b: FileFingerprint | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.mtimeMs === b.mtimeMs && a.size === b.size;
}

export class TourWatcher {
  private watcher: FSWatcher | null = null;
  private commentDebounce: ReturnType<typeof setTimeout> | null = null;
  private lockDebounce: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;
  private readonly tourId: string;
  private readonly tourDir: string;
  private listeners: WatchCallback[] = [];
  private lastLockExists: boolean;
  private lastCommentsFp: FileFingerprint | null;

  constructor(repoRoot: string, tourId: string, debounceMs = 100) {
    this.tourId = tourId;
    this.tourDir = join(repoRoot, ".tour", tourId);
    this.debounceMs = debounceMs;
    this.lastLockExists = existsSync(join(this.tourDir, REPLY_LOCK_FILENAME));
    this.lastCommentsFp = effectiveCommentsFingerprint(this.tourDir);
  }

  on(callback: WatchCallback): void {
    this.listeners.push(callback);
  }

  off(callback: WatchCallback): void {
    this.listeners = this.listeners.filter((l) => l !== callback);
  }

  start(): void {
    if (this.watcher) return;

    try {
      this.watcher = watch(this.tourDir, { recursive: false }, (_eventType, filename) => {
        if (!filename) return;
        if (filename.endsWith(".jsonl")) {
          this.scheduleCommentEmit();
        } else if (filename === REPLY_LOCK_FILENAME) {
          this.scheduleLockEmit();
        }
      });
    } catch {
      // directory may not exist yet
    }
  }

  stop(): void {
    if (this.commentDebounce) {
      clearTimeout(this.commentDebounce);
      this.commentDebounce = null;
    }
    if (this.lockDebounce) {
      clearTimeout(this.lockDebounce);
      this.lockDebounce = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.listeners = [];
  }

  // macOS fs.watch fires spurious `rename` events for sibling files when an
  // unrelated file in the same directory is created or deleted. Without a
  // fingerprint check, writing `.reply-lock.json` would emit a phantom
  // `comment-changed` because the Comment-log file shows up in the
  // watch callback. Stat at fire time and only emit if mtime+size actually
  // changed. The effective fingerprint prefers `comments.jsonl` and falls
  // back to `annotations.jsonl`, mirroring the reader (ADR 0029 addendum).
  private scheduleCommentEmit(): void {
    if (this.commentDebounce) clearTimeout(this.commentDebounce);
    this.commentDebounce = setTimeout(() => {
      const fp = effectiveCommentsFingerprint(this.tourDir);
      if (sameFingerprint(fp, this.lastCommentsFp)) return;
      this.lastCommentsFp = fp;
      this.emit({ type: "comment-changed", tourId: this.tourId });
    }, this.debounceMs);
  }

  // Lock events are kind-discriminated (in-flight / cleared) by checking
  // whether the file exists at debounce time. fs.watch fires for both create
  // and delete with the same filename, so the existence check at fire time
  // is what tells us which side of the event we're seeing.
  private scheduleLockEmit(): void {
    if (this.lockDebounce) clearTimeout(this.lockDebounce);
    this.lockDebounce = setTimeout(() => {
      const exists = existsSync(join(this.tourDir, REPLY_LOCK_FILENAME));
      if (exists === this.lastLockExists) return;
      this.lastLockExists = exists;
      this.emit({
        type: exists ? "reply-in-flight" : "reply-cleared",
        tourId: this.tourId,
      });
    }, this.debounceMs);
  }

  private emit(event: WatchEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
