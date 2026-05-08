import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";

export type WatchEvent = {
  type: "annotation-changed";
  tourId: string;
};

export type WatchCallback = (event: WatchEvent) => void;

export class TourWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;
  private readonly tourId: string;
  private readonly tourDir: string;
  private listeners: WatchCallback[] = [];

  constructor(repoRoot: string, tourId: string, debounceMs = 100) {
    this.tourId = tourId;
    this.tourDir = join(repoRoot, ".tour", tourId);
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
      this.watcher = watch(this.tourDir, { recursive: false }, (_eventType, filename) => {
        if (filename?.endsWith(".jsonl")) {
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
        tourId: this.tourId,
      };
      for (const listener of this.listeners) {
        listener(event);
      }
    }, this.debounceMs);
  }
}
