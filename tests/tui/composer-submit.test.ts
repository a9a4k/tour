import { describe, it, expect, vi } from "vitest";
import { createComposerSubmitter } from "../../src/tui/composer-submit.js";
import type { ComposerState } from "../../src/tui/composer-state.js";
import type { Annotation } from "../../src/core/types.js";
import type { TourBundle } from "../../src/core/tour-bundle.js";

function ann(overrides: Partial<Annotation> & Pick<Annotation, "id">): Annotation {
  return {
    id: overrides.id,
    file: overrides.file ?? "src/x.ts",
    side: overrides.side ?? "additions",
    line_start: overrides.line_start ?? 10,
    line_end: overrides.line_end ?? 10,
    body: overrides.body ?? "agent note",
    author: overrides.author ?? "agent",
    author_kind: overrides.author_kind ?? "agent",
    replies_to: overrides.replies_to,
    created_at: overrides.created_at ?? "2026-01-01T00:00:00Z",
  };
}

const parent = ann({ id: "parent-1" });
const bundle: TourBundle = {
  kind: "snapshot-lost",
  tour: { id: "t1", title: "t", base_sha: "b", head_sha: "h", status: "active", created_at: "2026-01-01T00:00:00Z" } as never,
  annotations: [],
};

const replyComposer: ComposerState = { kind: "reply", parent };
const topLevelComposer: ComposerState = {
  kind: "top-level",
  file: "src/x.ts",
  side: "additions",
  line_start: 7,
  line_end: 7,
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createComposerSubmitter — double-submit guard (#159)", () => {
  it("ignores a second submit while the first is in flight (reply path)", async () => {
    const d = deferred<Annotation>();
    const writeAnnotation = vi.fn(() => d.promise);
    const dismiss = vi.fn();
    const submit = createComposerSubmitter();

    const args = {
      composer: replyComposer,
      body: "hello",
      tourId: "t1",
      bundle,
      writeAnnotation,
      dismiss,
    };

    const first = submit(args);
    // While the first awaits, the input is still mounted in the live TUI;
    // a second Enter would call submit again. The guard must drop it.
    const second = submit(args);

    d.resolve(ann({ id: "reply-1" }));
    await Promise.all([first, second]);

    expect(writeAnnotation).toHaveBeenCalledTimes(1);
    // Dismiss is called exactly once — the second submit returns before
    // touching state.
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("ignores a second submit while the first is in flight (top-level path)", async () => {
    const d = deferred<Annotation>();
    const writeAnnotation = vi.fn(() => d.promise);
    const dismiss = vi.fn();
    const submit = createComposerSubmitter();

    const args = {
      composer: topLevelComposer,
      body: "hello",
      tourId: "t1",
      bundle,
      writeAnnotation,
      dismiss,
    };

    const first = submit(args);
    const second = submit(args);

    d.resolve(ann({ id: "top-1" }));
    await Promise.all([first, second]);

    expect(writeAnnotation).toHaveBeenCalledTimes(1);
  });

  it("dismisses the composer synchronously before awaiting the write", async () => {
    const d = deferred<Annotation>();
    const writeAnnotation = vi.fn(() => d.promise);
    const dismiss = vi.fn();
    const submit = createComposerSubmitter();

    const pending = submit({
      composer: replyComposer,
      body: "hi",
      tourId: "t1",
      bundle,
      writeAnnotation,
      dismiss,
    });

    // Before resolving the write, the synchronous dismiss must have already
    // fired (that's what unmounts the focused <input> in the live TUI).
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(writeAnnotation).toHaveBeenCalledTimes(1);

    d.resolve(ann({ id: "reply-1" }));
    await pending;
  });

  it("releases the in-flight guard after the first submit completes", async () => {
    const writeAnnotation = vi.fn(async () => ann({ id: "x" }));
    const dismiss = vi.fn();
    const submit = createComposerSubmitter();

    await submit({
      composer: replyComposer,
      body: "first",
      tourId: "t1",
      bundle,
      writeAnnotation,
      dismiss,
    });
    await submit({
      composer: replyComposer,
      body: "second",
      tourId: "t1",
      bundle,
      writeAnnotation,
      dismiss,
    });

    expect(writeAnnotation).toHaveBeenCalledTimes(2);
  });

  it("releases the in-flight guard even when the write throws", async () => {
    const writeAnnotation = vi
      .fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(ann({ id: "ok-1" }));
    const dismiss = vi.fn();
    const submit = createComposerSubmitter();

    await submit({
      composer: replyComposer,
      body: "boom",
      tourId: "t1",
      bundle,
      writeAnnotation,
      dismiss,
    });
    // Composer is dismissed (draft lost) — matches the previous finally-block
    // behavior in app.tsx and the issue's acceptance criterion #5.
    expect(dismiss).toHaveBeenCalledTimes(1);

    await submit({
      composer: replyComposer,
      body: "retry",
      tourId: "t1",
      bundle,
      writeAnnotation,
      dismiss,
    });
    expect(writeAnnotation).toHaveBeenCalledTimes(2);
  });

  it("empty-body submit silently dismisses with no write", async () => {
    const writeAnnotation = vi.fn();
    const dismiss = vi.fn();
    const submit = createComposerSubmitter();

    await submit({
      composer: replyComposer,
      body: "   ",
      tourId: "t1",
      bundle,
      writeAnnotation,
      dismiss,
    });

    expect(writeAnnotation).not.toHaveBeenCalled();
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("top-level submit reports the created id via applyTopLevelCreated", async () => {
    const writeAnnotation = vi.fn(async () => ann({ id: "new-top" }));
    const applyTopLevelCreated = vi.fn();
    const submit = createComposerSubmitter();

    await submit({
      composer: topLevelComposer,
      body: "fresh note",
      tourId: "t1",
      bundle,
      writeAnnotation,
      dismiss: () => {},
      applyTopLevelCreated,
    });

    expect(applyTopLevelCreated).toHaveBeenCalledWith("new-top");
  });

  it("reply submit does not call applyTopLevelCreated", async () => {
    const writeAnnotation = vi.fn(async () => ann({ id: "reply-id" }));
    const applyTopLevelCreated = vi.fn();
    const submit = createComposerSubmitter();

    await submit({
      composer: replyComposer,
      body: "thanks",
      tourId: "t1",
      bundle,
      writeAnnotation,
      dismiss: () => {},
      applyTopLevelCreated,
    });

    expect(applyTopLevelCreated).not.toHaveBeenCalled();
  });

  it("reloads the bundle after a successful write", async () => {
    const writeAnnotation = vi.fn(async () => ann({ id: "x" }));
    const refreshed: TourBundle = { ...bundle };
    const loadTour = vi.fn(async () => refreshed);
    const applyBundleReload = vi.fn();
    const submit = createComposerSubmitter();

    await submit({
      composer: replyComposer,
      body: "hi",
      tourId: "t1",
      bundle,
      writeAnnotation,
      loadTour,
      dismiss: () => {},
      applyBundleReload,
    });

    expect(loadTour).toHaveBeenCalledWith("t1");
    expect(applyBundleReload).toHaveBeenCalledWith(refreshed);
  });

  it("no writeAnnotation prop → dismiss without throw (graceful no-op)", async () => {
    const dismiss = vi.fn();
    const submit = createComposerSubmitter();

    await submit({
      composer: replyComposer,
      body: "hi",
      tourId: "t1",
      bundle,
      dismiss,
    });

    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});
