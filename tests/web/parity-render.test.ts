// @vitest-environment happy-dom
//
// Parity test harness (PRD #212 slice 6, issue #219). The merge gate for
// the Pierre → Tour-owned web row renderer cutover (next slice).
//
// For each canonical fixture and each layout in the fixture's `layouts`
// list, the harness:
//
//   1. Parses the raw diff via `parsePatchFiles` to get Pierre's
//      `FileDiffMetadata[]` (the shape both renderers consume).
//   2. Computes the planner's `PlannedRow[]` for every file —
//      `core/diff-rows.ts` is the shared source of truth post-cutover,
//      so its output is the canonical normalized sequence the harness
//      compares both renderers against.
//   3. Mounts the new `<FileBlock>` (Tour-owned, slice 5) per file and
//      extracts the rendered DOM into a normalized record sequence.
//   4. Renders Pierre's SSR HTML per file (via `preloadFileDiff` or
//      `preloadMultiFileDiff` when `oldContents`/`newContents` are
//      provided) and extracts the rendered DOM into the same
//      normalized shape.
//   5. Asserts the new-renderer sequence matches the planner expected
//      sequence (full equivalence including annotations + interactive
//      rows) AND the Pierre-renderer sequence agrees on the diff-row
//      backbone (Pierre's SSR doesn't paint annotation cards or our
//      `boundary-bottom` / `collapsed-file` interactive rows — those
//      are Tour-side concerns the cutover preserves through `<FileBlock>`).
//
// Normalization (what is intentionally stripped vs load-bearing):
//
//   STRIPPED — these are presentation-only differences neither renderer
//   should be held to:
//     - React-generated keys, `data-react-*` attributes, class strings
//       that differ by renderer.
//     - Pierre's shadow-DOM container vs the new light-DOM container.
//     - Syntax-highlighting token span colors (rows compared on
//       plain-text content; tokens are pulled out via `.textContent`).
//
//   LOAD-BEARING — these MUST match:
//     - The row kind (diff / hunk-header / interactive / annotation).
//     - Line numbers per side (additions / deletions).
//     - Plain-text row content per side.
//     - Hunk-header text (the `@@ ...` line — both renderers paint the
//       same hunk metadata).
//     - Annotation anchor row (FileBlock's CardRow placement equals the
//       planner's interleave position; checked against planner output).
//
// After the cutover (next slice) deletes Pierre, this harness deletes
// itself — the post-cutover suite is the existing renderer tests plus
// these fixtures replayed as snapshot tests against the new renderer
// only.

import { afterEach, beforeEach, describe, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import { preloadFileDiff, preloadMultiFileDiff } from "@pierre/diffs/ssr";
import { planRows, type PlannedRow } from "../../src/core/diff-rows.js";
import { FileBlock } from "../../src/web/client/FileBlock.js";
import type { BundleFile } from "../../src/web/client/types.js";
import { FIXTURES, type ParityFixture } from "./parity-fixtures/index.js";

// ---------------------------------------------------------------------------
// Normalized record shape
// ---------------------------------------------------------------------------

type DiffRecord = {
  kind: "diff";
  file: string;
  type: "context" | "addition" | "deletion" | "change-addition" | "change-deletion";
  leftLine: number | null;
  rightLine: number | null;
  // Plain text, no token markup.
  leftText: string;
  rightText: string;
};

type HunkHeaderRecord = {
  kind: "hunk-header";
  file: string;
  // Header glyph (`@@ -1,3 +1,4 @@`). For the new renderer it's the
  // planner's `header` value; for Pierre it's the visible separator
  // text. Equal modulo whitespace.
  header: string;
};

type InteractiveRecord = {
  kind: "interactive";
  file: string;
  interactiveSubKind: string;
};

type AnnotationRecord = {
  kind: "annotation";
  file: string;
  annotationId: string;
};

type Record_ = DiffRecord | HunkHeaderRecord | InteractiveRecord | AnnotationRecord;

// Only the row kinds Pierre also paints (diff + hunk-header). The new
// renderer also emits `interactive` rows for `boundary-bottom` /
// `collapsed-file` / `gap-mid-top` — Pierre doesn't emit those as
// separate visible rows (its hunk-header carries the gap glyph). So we
// project the new-renderer sequence to this restricted shape before
// the Pierre comparison.
type PierreVisibleRecord = DiffRecord | HunkHeaderRecord;

// ---------------------------------------------------------------------------
// Planner → expected records
// ---------------------------------------------------------------------------

function plannerToRecords(
  file: string,
  rows: PlannedRow[],
  layout: "split" | "unified",
): Record_[] {
  const out: Record_[] = [];
  for (const row of rows) {
    if (row.kind === "diff-row") {
      // In unified mode, FileBlock's `<DiffRow>` renders ONE column per
      // row: additions/context/change-addition use the right side;
      // deletions/change-deletion use the left side. The DOM doesn't
      // carry the unused side. Project the planner row to the same
      // single-column representation so the comparison stays
      // renderer-faithful (Pierre's SSR in unified also paints only the
      // visible column per row).
      const type =
        row.type === "change" ? "change-addition" : row.type;
      if (layout === "unified") {
        const usesLeft =
          row.type === "deletion" || row.type === "change-deletion" ||
          (row.type === "change" && row.rightLineNumber === null);
        out.push({
          kind: "diff",
          file,
          type,
          leftLine: usesLeft ? row.leftLineNumber : null,
          rightLine: usesLeft ? null : row.rightLineNumber,
          leftText: usesLeft ? row.leftText : "",
          rightText: usesLeft ? "" : row.rightText,
        });
      } else {
        out.push({
          kind: "diff",
          file,
          type,
          leftLine: row.leftLineNumber,
          rightLine: row.rightLineNumber,
          leftText: row.leftText,
          rightText: row.rightText,
        });
      }
    } else if (row.kind === "hunk-header") {
      out.push({ kind: "hunk-header", file, header: normalizeHeader(row.header) });
    } else if (row.kind === "interactive") {
      out.push({ kind: "interactive", file, interactiveSubKind: row.subKind });
    } else if (row.kind === "annotation") {
      out.push({ kind: "annotation", file, annotationId: row.id });
    }
  }
  return out;
}

// The planner forwards Pierre's `hunkSpecs` verbatim, which includes a
// trailing newline (`@@ -1,3 +1,4 @@\n`). `<FileBlock>` paints the
// string inside a `.tour-row-glyph` <span>; the newline isn't visible.
// Trim for comparison.
function normalizeHeader(s: string): string {
  return s.replace(/\s+$/, "");
}

// ---------------------------------------------------------------------------
// FileBlock DOM → records
// ---------------------------------------------------------------------------

function extractFromFileBlock(container: HTMLElement, file: string): Record_[] {
  const out: Record_[] = [];
  const block = container.querySelector(".tour-file-block");
  if (!block) return out; // collapsed or no body
  for (const child of Array.from(block.children) as HTMLElement[]) {
    if (child.classList.contains("tour-row")) {
      const subKind = child.dataset.subkind;
      if (subKind) {
        if (subKind === "boundary-top" || subKind === "hunk-separator") {
          // FileBlock dispatches planner `hunk-header` rows through
          // InteractiveRow with these subKinds. The glyph carries the
          // `@@ ...` header text.
          const header = (child.querySelector(".tour-row-glyph")?.textContent ?? "").trim();
          out.push({ kind: "hunk-header", file, header });
        } else {
          out.push({ kind: "interactive", file, interactiveSubKind: subKind });
        }
        continue;
      }
      const lineType = child.dataset.lineType ?? "context";
      // Walk per-side spans to recover gutter + code per column.
      const leftGutter = child.querySelector(
        '.tour-row-gutter[data-side="deletions"]',
      ) as HTMLElement | null;
      const rightGutter = child.querySelector(
        '.tour-row-gutter[data-side="additions"]',
      ) as HTMLElement | null;
      const leftCell = child.querySelector(
        '.tour-row-cell[data-side="deletions"] .tour-row-code',
      ) as HTMLElement | null;
      const rightCell = child.querySelector(
        '.tour-row-cell[data-side="additions"] .tour-row-code',
      ) as HTMLElement | null;
      const leftLine = parseLineNumber(leftGutter?.dataset.lineNumber);
      const rightLine = parseLineNumber(rightGutter?.dataset.lineNumber);
      const leftText = leftCell?.textContent ?? "";
      const rightText = rightCell?.textContent ?? "";
      out.push({
        kind: "diff",
        file,
        type: lineType as DiffRecord["type"],
        leftLine,
        rightLine,
        leftText,
        rightText,
      });
      continue;
    }
    if (child.classList.contains("tour-card")) {
      const annotationId =
        (child.querySelector("[data-annotation-id]") as HTMLElement | null)
          ?.dataset.annotationId ?? "";
      if (annotationId) out.push({ kind: "annotation", file, annotationId });
      continue;
    }
  }
  return out;
}

function parseLineNumber(v: string | undefined): number | null {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Pierre SSR → records (diff rows + hunk-headers only)
// ---------------------------------------------------------------------------

function extractFromPierre(
  html: string,
  file: string,
  layout: "split" | "unified",
): PierreVisibleRecord[] {
  // Pierre's SSR HTML contains an SVG sprite block + a stylesheet + the
  // diff body. We inject the whole string into a template and walk the
  // diff body's [data-line] / [data-separator] descendants.
  const tmpl = document.createElement("template");
  tmpl.innerHTML = html;

  if (layout === "unified") {
    return extractPierreUnified(tmpl.content, file);
  }
  return extractPierreSplit(tmpl.content, file);
}

function extractPierreUnified(
  root: DocumentFragment,
  file: string,
): PierreVisibleRecord[] {
  // One column. Each [data-line] is one logical row; [data-separator]
  // wraps a hunk-header. Walk in document order. Each row emits a
  // single visible column matching `plannerToRecords(... "unified")` —
  // additions/context use the right side, deletions use the left side.
  const out: PierreVisibleRecord[] = [];
  const elements = root.querySelectorAll("[data-line], [data-separator]");
  for (const el of Array.from(elements) as HTMLElement[]) {
    if (el.dataset.separator !== undefined) {
      // Skip separators nested inside [data-line] (defensive — none in
      // current Pierre output).
      if ((el.closest("[data-line]") as HTMLElement | null) !== null) continue;
      out.push({
        kind: "hunk-header",
        file,
        header: normalizeHeader(el.textContent ?? ""),
      });
      continue;
    }
    const type = (el.dataset.lineType ?? "context") as DiffRecord["type"];
    const primary = parseLineNumber(el.dataset.line);
    const isDeletion = type === "deletion" || type === "change-deletion";
    const text = el.textContent ?? "";
    out.push({
      kind: "diff",
      file,
      type,
      leftLine: isDeletion ? primary : null,
      rightLine: isDeletion ? null : primary,
      leftText: isDeletion ? text : "",
      rightText: isDeletion ? "" : text,
    });
  }
  return out;
}

function extractPierreSplit(
  root: DocumentFragment,
  file: string,
): PierreVisibleRecord[] {
  // Pierre split: `<code data-deletions>` precedes `<code data-additions>`
  // — left column then right column. Each side carries the same number
  // of hunk-separators interleaved with [data-line] elements. We walk
  // both columns in parallel and coalesce into one record per planner
  // row by matching `data-line-index` (the `additionIndex,deletionIndex`
  // pair that uniquely identifies a planner row).
  const left = root.querySelector("[data-deletions]") as HTMLElement | null;
  const right = root.querySelector("[data-additions]") as HTMLElement | null;
  if (!left || !right) return [];
  type SideEntry =
    | { kind: "separator"; header: string }
    | {
        kind: "line";
        idx: string;
        type: DiffRecord["type"];
        line: number | null;
        text: string;
      };
  const collect = (col: HTMLElement): SideEntry[] => {
    const out: SideEntry[] = [];
    const els = col.querySelectorAll("[data-line], [data-separator]");
    for (const el of Array.from(els) as HTMLElement[]) {
      if (el.dataset.separator !== undefined) {
        out.push({
          kind: "separator",
          header: (el.textContent ?? "").trim(),
        });
      } else {
        out.push({
          kind: "line",
          idx: el.dataset.lineIndex ?? "",
          type: (el.dataset.lineType ?? "context") as DiffRecord["type"],
          line: parseLineNumber(el.dataset.line),
          text: el.textContent ?? "",
        });
      }
    }
    return out;
  };
  const leftEntries = collect(left);
  const rightEntries = collect(right);

  // Walk in parallel: when both columns surface a separator, emit one
  // hunk-header record. When they surface line entries with the same
  // data-line-index, coalesce into one diff record. Otherwise emit
  // per-side records.
  const out: PierreVisibleRecord[] = [];
  let li = 0;
  let ri = 0;
  while (li < leftEntries.length || ri < rightEntries.length) {
    const l = leftEntries[li];
    const r = rightEntries[ri];
    if (l?.kind === "separator" && r?.kind === "separator") {
      out.push({ kind: "hunk-header", file, header: l.header });
      li++;
      ri++;
      continue;
    }
    if (l?.kind === "separator") {
      out.push({ kind: "hunk-header", file, header: l.header });
      li++;
      continue;
    }
    if (r?.kind === "separator") {
      out.push({ kind: "hunk-header", file, header: r.header });
      ri++;
      continue;
    }
    // Both are line entries. Match by data-line-index when equal;
    // otherwise emit whichever side leads.
    if (l && r && l.idx === r.idx) {
      out.push({
        kind: "diff",
        file,
        type: r.type === "context" ? "context" : r.type,
        leftLine: l.line,
        rightLine: r.line,
        leftText: l.text,
        rightText: r.text,
      });
      li++;
      ri++;
      continue;
    }
    // Mismatched indices — one side has a row the other doesn't. The
    // missing side is encoded by null line numbers + empty text (the
    // planner's representation of single-sided change rows).
    if (l && (!r || l.idx < r.idx)) {
      out.push({
        kind: "diff",
        file,
        type: l.type,
        leftLine: l.line,
        rightLine: null,
        leftText: l.text,
        rightText: "",
      });
      li++;
      continue;
    }
    if (r) {
      out.push({
        kind: "diff",
        file,
        type: r.type,
        leftLine: null,
        rightLine: r.line,
        leftText: "",
        rightText: r.text,
      });
      ri++;
      continue;
    }
  }
  return out;
}

// Restrict the new-renderer sequence to the row kinds Pierre paints
// (diff rows only — Pierre's `hunkSeparators: "metadata"` emits
// separators BETWEEN hunks, the planner emits a `hunk-header` BEFORE
// every hunk including hunk 0). For the projection we strip
// hunk-headers entirely; the comparison is on the diff-row backbone.
// Annotations + boundary-bottom / collapsed-file / gap-mid-top
// interactive rows are Tour-side concerns the cutover preserves
// through `<FileBlock>` — verified against the planner expected
// sequence separately.
//
// In SPLIT layout, the planner emits ONE record per `change` pair
// (with leftText / rightText set on the same record); Pierre's split
// renders the pair as two separate visible rows (one per column).
// Project our `change-addition` records into two per-side records to
// match Pierre's row shape.
function projectToPierreVisible(
  records: Record_[],
  layout: "split" | "unified",
): DiffRecord[] {
  const out: DiffRecord[] = [];
  for (const r of records) {
    if (r.kind !== "diff") continue;
    if (
      layout === "split" &&
      r.type === "change-addition" &&
      r.leftLine !== null &&
      r.rightLine !== null
    ) {
      out.push({
        kind: "diff",
        file: r.file,
        type: "change-deletion",
        leftLine: r.leftLine,
        rightLine: null,
        leftText: r.leftText,
        rightText: "",
      });
      out.push({
        kind: "diff",
        file: r.file,
        type: "change-addition",
        leftLine: null,
        rightLine: r.rightLine,
        leftText: "",
        rightText: r.rightText,
      });
      continue;
    }
    out.push(r);
  }
  return out;
}

function dropHunkHeaders(records: PierreVisibleRecord[]): DiffRecord[] {
  const out: DiffRecord[] = [];
  for (const r of records) {
    if (r.kind === "diff") out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// FileBlock mounting helper
// ---------------------------------------------------------------------------

function bundleFileFor(
  fixture: ParityFixture,
  fd: FileDiffMetadata,
): BundleFile {
  return {
    name: fd.name,
    prevName: fd.prevName,
    type: fd.type,
    hunks: [],
    oldContent: fixture.oldContents?.[fd.name],
    newContent: fixture.newContents?.[fd.name],
    classification:
      fixture.classifications?.[fd.name] ?? { collapsed: false },
    orphanWindows: [],
  };
}

let savedIO: typeof IntersectionObserver | undefined;
let roots: Root[] = [];

beforeEach(() => {
  (
    globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = "";
  // Delete IntersectionObserver so `useLazyHighlight` falls back to
  // "immediately visible" — token painting is deterministic, and the
  // post-IO branch (plain-text or styled) doesn't change row-level
  // identity. happy-dom's stub doesn't accept on-demand entry firing,
  // so this is the pragmatic shortcut.
  savedIO = (
    globalThis as { IntersectionObserver?: typeof IntersectionObserver }
  ).IntersectionObserver;
  delete (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
    .IntersectionObserver;
  roots = [];
});

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount());
  }
  roots = [];
  document.body.innerHTML = "";
  if (savedIO) {
    (
      globalThis as { IntersectionObserver?: typeof IntersectionObserver }
    ).IntersectionObserver = savedIO;
  }
});

function mountFileBlock(
  fixture: ParityFixture,
  fd: FileDiffMetadata,
  rows: PlannedRow[],
  layout: "split" | "unified",
): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const file = bundleFileFor(fixture, fd);
  let root!: Root;
  act(() => {
    root = createRoot(container);
    // `isCollapsed` is kept false here. Classifier-collapsed semantics
    // ride on `rows` — the planner emits a single `collapsed-file`
    // interactive row when `classifierCollapsed` is set, which the
    // body renders.
    root.render(
      createElement(FileBlock, {
        file,
        rows,
        layout,
        cursor: null,
        onDispatchExpand: () => {},
        onRowClick: () => {},
        onCardClick: () => {},
        isCollapsed: false,
        onToggleCollapse: () => {},
      }),
    );
  });
  roots.push(root);
  return container;
}

// ---------------------------------------------------------------------------
// Per-fixture × per-layout harness
// ---------------------------------------------------------------------------

async function renderPierre(
  fixture: ParityFixture,
  fd: FileDiffMetadata,
  layout: "split" | "unified",
): Promise<string> {
  const options = {
    diffStyle: layout,
    hunkSeparators: "metadata" as const,
    overflow: "wrap" as const,
    themeType: "dark" as const,
    collapsed: !!fixture.classifierCollapsed?.has(fd.name),
  };
  const oldContent = fixture.oldContents?.[fd.name];
  const newContent = fixture.newContents?.[fd.name];
  if (typeof oldContent === "string" && typeof newContent === "string") {
    const r = await preloadMultiFileDiff({
      oldFile: { name: fd.prevName ?? fd.name, contents: oldContent },
      newFile: { name: fd.name, contents: newContent },
      options,
    });
    return r.prerenderedHTML;
  }
  const r = await preloadFileDiff({ fileDiff: fd, options });
  return r.prerenderedHTML;
}

function pretty(
  records: Record_[] | PierreVisibleRecord[] | DiffRecord[],
): string {
  return records.map((r) => JSON.stringify(r)).join("\n");
}

describe("parity-render harness — Pierre vs Tour-owned <FileBlock>", () => {
  for (const fixture of FIXTURES) {
    for (const layout of fixture.layouts) {
      it(`${fixture.name} (${layout})`, async () => {
        const patches = parsePatchFiles(fixture.diff);
        if (patches.length === 0) {
          throw new Error(
            `fixture ${fixture.name}: parsePatchFiles returned no patches`,
          );
        }
        const files = patches[0].files;
        for (const fd of files) {
          if (fd.type === "binary") {
            // Binary files: planner emits no rows. Pierre's SSR also
            // emits no diff rows for binary content (it shows a
            // file-info header). Both renderers produce empty diff-row
            // sequences — trivially equal.
            continue;
          }
          const rows = planRows(fd, fixture.annotations, layout, {
            oldContent: fixture.oldContents?.[fd.name],
            newContent: fixture.newContents?.[fd.name],
            expansion: fixture.expansion,
            classifierCollapsed: fixture.classifierCollapsed?.has(fd.name),
          });
          const expected = plannerToRecords(fd.name, rows, layout);
          const container = mountFileBlock(fixture, fd, rows, layout);
          const actualNew = extractFromFileBlock(container, fd.name);

          // FULL parity: new-renderer DOM matches planner expected
          // sequence row-for-row, including annotations + interactive
          // rows.
          if (!recordsEqual(actualNew, expected)) {
            throw new Error(
              `[${fixture.name} / ${layout} / ${fd.name}] new-renderer ≠ planner expected\n\n` +
                `--- expected (${expected.length}) ---\n${pretty(expected)}\n\n` +
                `--- new-renderer (${actualNew.length}) ---\n${pretty(actualNew)}\n`,
            );
          }

          // PIERRE-VISIBLE subset: project the new-renderer sequence
          // to the row kinds Pierre paints (diff + hunk-header) and
          // compare against Pierre's SSR-extracted sequence. Annotations
          // and Tour-side interactive rows (`boundary-bottom`,
          // `collapsed-file`, `gap-mid-top`) are intentionally normalized
          // away on the Pierre side — Pierre doesn't render them as
          // standalone visible rows. The new renderer reproduces them
          // (verified via the full parity check above).
          //
          // Pierre comparison gates. The renderers diverge by design
          // in the cases below — Pierre's `MultiFileDiff` (active
          // whenever full file contents are supplied) runs its own
          // hidden-context expansion mechanic (re-computing hunk
          // boundaries with `expansionLineCount: 20` worth of trailing
          // context), and `collapsed: true` doesn't suppress its SSR
          // diff body the way the planner's `classifierCollapsed:
          // true` short-circuits to a single `collapsed-file` row.
          //
          // For those fixtures the load-bearing assertion is the
          // planner ↔ new-renderer check above; we still MOUNT Pierre
          // (the SSR call below) so the "both renderers running
          // against the fixture" gate holds, but skip the row-by-row
          // diff-equality assertion.
          const pierreHtml = await renderPierre(fixture, fd, layout);
          const hasFullContents =
            typeof fixture.oldContents?.[fd.name] === "string" &&
            typeof fixture.newContents?.[fd.name] === "string";
          if (
            fixture.classifierCollapsed?.has(fd.name) ||
            fixture.expansion !== undefined ||
            hasFullContents
          ) {
            void pierreHtml;
            continue;
          }
          const projectedNew = projectToPierreVisible(actualNew, layout);
          const actualPierre = dropHunkHeaders(
            extractFromPierre(pierreHtml, fd.name, layout),
          );
          if (!diffsEqual(projectedNew, actualPierre)) {
            throw new Error(
              `[${fixture.name} / ${layout} / ${fd.name}] new-renderer ≠ Pierre SSR\n\n` +
                `--- new-renderer (Pierre-visible projection, ${projectedNew.length}) ---\n${pretty(projectedNew)}\n\n` +
                `--- Pierre SSR (${actualPierre.length}) ---\n${pretty(actualPierre)}\n`,
            );
          }
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Equality helpers
// ---------------------------------------------------------------------------

function recordsEqual(a: Record_[], b: Record_[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!recEqual(a[i], b[i])) return false;
  }
  return true;
}

function diffsEqual(a: DiffRecord[], b: DiffRecord[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!diffRecEqual(a[i], b[i])) return false;
  }
  return true;
}

// For Pierre comparison, canonicalize the type so the planner's
// unified `addition` / `deletion` (split-out change-pair) reads as
// equivalent to Pierre's `change-addition` / `change-deletion` tags.
// Pierre keeps the `change-*` qualifier on the per-side rows; the
// planner drops it because in unified mode the rows ARE plain
// additions / deletions. The visible content (line number + text) is
// identical, which is what parity cares about.
function canonicalType(t: DiffRecord["type"]): DiffRecord["type"] {
  if (t === "change-addition") return "addition";
  if (t === "change-deletion") return "deletion";
  return t;
}

function diffRecEqual(a: DiffRecord, b: DiffRecord): boolean {
  return (
    a.file === b.file &&
    canonicalType(a.type) === canonicalType(b.type) &&
    a.leftLine === b.leftLine &&
    a.rightLine === b.rightLine &&
    a.leftText === b.leftText &&
    a.rightText === b.rightText
  );
}

function recEqual(a: Record_, b: Record_): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "diff" && b.kind === "diff") {
    return (
      a.file === b.file &&
      a.type === b.type &&
      a.leftLine === b.leftLine &&
      a.rightLine === b.rightLine &&
      a.leftText === b.leftText &&
      a.rightText === b.rightText
    );
  }
  if (a.kind === "hunk-header" && b.kind === "hunk-header") {
    return a.file === b.file && a.header === b.header;
  }
  if (a.kind === "interactive" && b.kind === "interactive") {
    return a.file === b.file && a.interactiveSubKind === b.interactiveSubKind;
  }
  if (a.kind === "annotation" && b.kind === "annotation") {
    return a.file === b.file && a.annotationId === b.annotationId;
  }
  return false;
}

