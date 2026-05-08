import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";

export type WatchEvent = {
  type: "annotation-changed";
  reviewId: string;
};

export type WatchCallback = (event: WatchEvent) => void;

export class ReviewWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;
  private readonly reviewId: string;
  private readonly reviewDir: string;
  private listeners: WatchCallback[] = [];

  constructor(repoRoot: string, reviewId: string, debounceMs = 100) {
    this.reviewId = reviewId;
    this.reviewDir = join(repoRoot, ".review", reviewId);
    this.debounceMs = debounceMs;
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
      this.watcher = watch(this.reviewDir, { recursive: false }, (_eventType, filename) => {
        if (filename === "annotations.jsonl" || filename?.endsWith(".jsonl")) {
          this.scheduleEmit();
        }
      });
    } catch {
      // directory may not exist yet
    }
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.listeners = [];
  }

  private scheduleEmit(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      const event: WatchEvent = {
        type: "annotation-changed",
        reviewId: this.reviewId,
      };
      for (const listener of this.listeners) {
        listener(event);
      }
    }, this.debounceMs);
  }
}
