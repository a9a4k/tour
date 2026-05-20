import { watch, existsSync, statSync, type FSWatcher } from "node:fs";
import { join } from "node:path";

export type WatchEvent =
  | { type: "comment-changed"; tourId: string }
  | { type: "reply-in-flight"; tourId: string }
  | { type: "reply-cleared"; tourId: string };

export type WatchCallback = (event: WatchEvent) => void;

const REPLY_LOCK_FILENAME = ".reply-lock.json";
// ADR 0036 on-disk filename. The event log replaces the per-Comment
// snapshot log (`comments.jsonl`, ADR 0029 Stage B). Legacy filenames
// are no longer read or watched — pre-1.0 status makes the migration
// cost-free.
const EVENTS_FILENAME = "tour-events.jsonl";

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

  constructor(tourStoreRoot: string, tourId: string, debounceMs = 100) {
    this.tourId = tourId;
    this.tourDir = join(tourStoreRoot, tourId);
    this.debounceMs = debounceMs;
    this.lastLockExists = existsSync(join(this.tourDir, REPLY_LOCK_FILENAME));
    this.lastCommentsFp = fingerprint(join(this.tourDir, EVENTS_FILENAME));
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
        if (filename === EVENTS_FILENAME) {
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
  // `comment-changed` because the events log file shows up in the
  // watch callback. Stat at fire time and only emit if mtime+size actually
  // changed.
  private scheduleCommentEmit(): void {
    if (this.commentDebounce) clearTimeout(this.commentDebounce);
    this.commentDebounce = setTimeout(() => {
      const fp = fingerprint(join(this.tourDir, EVENTS_FILENAME));
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
