import { describe, it, expect } from "vitest";
import {
  buildWriteAnnotationInput,
  type WriteAnnotationInput,
} from "../../src/core/write-annotation-input.js";
import type { ComposerTarget } from "../../src/core/tour-session.js";
import type { TourBundle } from "../../src/core/tour-bundle.js";
import type { Annotation, Tour } from "../../src/core/types.js";

const fixtureTour: Tour = {
  id: "tour-x",
  title: "t",
  status: "open",
  created_at: "2026-01-01T00:00:00Z",
  closed_at: "",
  head_sha: "deadbeef",
  base_sha: "cafef00d",
  head_source: "HEAD",
  base_source: "HEAD~1",
  wip_snapshot: false,
};

function bundle(overrides: { annotations?: Annotation[] } = {}): TourBundle {
  return {
    kind: "ok",
    tour: fixtureTour,
    annotations: overrides.annotations ?? [],
    diff: "",
    files: [],
  };
}

function mkAnnotation(over: Partial<Annotation> & Pick<Annotation, "id">): Annotation {
  return {
    id: over.id,
    file: over.file ?? "src/x.ts",
    side: over.side ?? "additions",
    line_start: over.line_start ?? 1,
    line_end: over.line_end ?? 1,
    body: over.body ?? "b",
    author: over.author ?? "h",
    author_kind: over.author_kind ?? "human",
    replies_to: over.replies_to,
    created_at: over.created_at ?? "2026-01-01T00:00:00Z",
  };
}

describe("buildWriteAnnotationInput", () => {
  // The bug: when constructing a top-level WriteAnnotationInput, the
  // surface was dropping the live bundle from the payload. The CLI's
  // writer callback then passed `input.bundle === undefined` into
  // `createAnnotation`'s anchor validator, which dereferenced
  // `undefined.kind` and threw. The builder ALWAYS attaches the live
  // bundle to a top-level input so the validator sees a real value.
  it("top-level target carries the live bundle through to the input", () => {
    const tgt: ComposerTarget = {
      kind: "top-level",
      file: "src/foo.ts",
      side: "additions",
      line_start: 10,
      line_end: 12,
    };
    const b = bundle();
    const result = buildWriteAnnotationInput({
      target: tgt,
      body: "the draft",
      bundle: b,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.input).toEqual<WriteAnnotationInput>({
      kind: "top-level",
      file: "src/foo.ts",
      side: "additions",
      line_start: 10,
      line_end: 12,
      body: "the draft",
      bundle: b,
    });
  });

  it("reply target resolves the parent annotation from the live bundle's annotations", () => {
    const parent = mkAnnotation({
      id: "ann-parent",
      file: "src/x.ts",
      side: "deletions",
      line_start: 3,
      line_end: 3,
    });
    const tgt: ComposerTarget = { kind: "reply", replies_to: "ann-parent" };
    const result = buildWriteAnnotationInput({
      target: tgt,
      body: "reply body",
      bundle: bundle({ annotations: [parent] }),
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.input).toEqual<WriteAnnotationInput>({
      kind: "reply",
      parent,
      body: "reply body",
    });
  });

  it("reply target with a vanished parent returns parent-missing (no input emitted)", () => {
    const tgt: ComposerTarget = { kind: "reply", replies_to: "ghost" };
    const result = buildWriteAnnotationInput({
      target: tgt,
      body: "x",
      bundle: bundle(),
    });
    expect(result.kind).toBe("parent-missing");
  });
});
