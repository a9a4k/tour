import type { PlannedRow } from "../../core/diff-rows.js";
import { queryAllAcrossShadow } from "./dom-walk.js";

/**
 * Tour-owned gap-row overlay on top of Pierre's diff DOM (PRD #151,
 * issue #154, ADR 0018). Pierre keeps owning the `@@` text + diff body +
 * syntax highlighting + annotation framework; Tour injects the
 * gap-row affordances: chevron icons, click handlers, cursor-walkable
 * standalone rows.
 *
 * Injected DOM:
 *   - **Chevron overlay** on each interactive `@@` row (planner emits a
 *     `hunk-header` with `gapAbove > 0`). Attached as a child of Pierre's
 *     `[data-separator="metadata"]` cell. Carries
 *     `data-tour-interactive="gap-row"`, `data-subkind="hunk-header"`,
 *     `data-hunk-index="N"`. Icon glyph: first-hunk file-top `↑`,
 *     mid-file small symmetric `↕`, mid-file large bottom `↓`.
 *   - **Standalone `gap-mid-top` row** inserted as the previousSibling of
 *     each interactive `@@` row whose planner emits a `gap-mid-top`
 *     interactive row (mid-file gap > 2N = 40).
 *     `data-tour-interactive="gap-row"`, `data-subkind="gap-mid-top"`,
 *     `data-hunk-index="N"`. Icon: `↑`.
 *   - **Standalone `boundary-bottom` row** inserted as the nextSibling of
 *     the file's last `[data-line]` cell whenever the planner emits a
 *     `boundary-bottom` interactive row. `data-tour-interactive="gap-row"`,
 *     `data-subkind="boundary-bottom"`. Icon: `↓`.
 *
 * Click handler resolves Pierre's per-file `FileDiff` instance via the
 * `fileDiffRefs` Map and calls `expandHunk(hunkIndex, direction, n)`.
 * Direction is derived from `(subKind, hunkIndex, gapAbove)`:
 *   - `subkind="hunk-header"` + `hunkIndex === 0` + `gapAbove > 0` → `"up"`
 *   - `subkind="hunk-header"` + `hunkIndex > 0` + `gapAbove <= 2N` → `"both"`
 *   - `subkind="hunk-header"` + `hunkIndex > 0` + `gapAbove > 2N` → `"down"`
 *   - `subkind="gap-mid-top"` → `"up"`
 *   - `subkind="boundary-bottom"` → `"down"`
 * Shift-click passes a large `expansionLineCount` (the gap-above for
 * hunk-header / gap-mid-top, a synthetic large constant for
 * boundary-bottom) so Pierre reveals the whole gap in one call.
 *
 * Idempotent attach: the overlay tags each injected node with
 * `data-tour-interactive` and skips creating a duplicate when one with
 * the same `(subKind, hunkIndex)` already exists at the target site.
 *
 * Cleanup callback removes every injected node — re-attach after cleanup
 * behaves identically to a fresh first attach.
 */

type FileDiffRef = {
  expandHunk: (
    hunkIndex: number,
    direction: "up" | "down" | "both",
    expansionLineCount?: number,
  ) => void;
};

export interface AttachGapRowOverlayArgs {
  root: HTMLElement;
  plannedRowsByFile: Map<string, PlannedRow[]>;
  fileDiffRefs: Map<string, FileDiffRef>;
  onAfterExpand: () => void;
}

const EXPANSION_STEP = 20;
const SHIFT_EXPAND_ALL = 1_000_000;
const GAP_TWO_ROW_THRESHOLD = 40;

interface HunkHeaderSpec {
  kind: "hunk-header";
  hunkIndex: number;
  gapAbove: number;
}

interface GapMidTopSpec {
  kind: "gap-mid-top";
  hunkIndex: number;
}

interface BoundaryBottomSpec {
  kind: "boundary-bottom";
}

type GapSpec = HunkHeaderSpec | GapMidTopSpec | BoundaryBottomSpec;

export function attachGapRowOverlay(args: AttachGapRowOverlayArgs): () => void {
  const injected: HTMLElement[] = [];
  const listeners: Array<{ el: HTMLElement; type: string; fn: EventListener }> = [];

  for (const block of queryAllAcrossShadow(args.root, "[data-file]")) {
    const file = (block as HTMLElement).dataset.file;
    if (!file) continue;
    const rows = args.plannedRowsByFile.get(file);
    if (!rows) continue;
    const ref = args.fileDiffRefs.get(file);
    if (!ref) continue;

    const specs = collectSpecs(rows);
    if (specs.length === 0) continue;

    const lastHunkIndex = lastHunkIndexFromPlan(rows);
    const separators = queryAllAcrossShadow(block, '[data-separator="metadata"]') as HTMLElement[];

    for (const spec of specs) {
      injectForSpec({
        spec,
        block: block as HTMLElement,
        separators,
        lastHunkIndex,
        expandHunk: ref.expandHunk,
        onAfterExpand: args.onAfterExpand,
        injected,
        listeners,
      });
    }
  }

  return (): void => {
    for (const { el, type, fn } of listeners) el.removeEventListener(type, fn);
    listeners.length = 0;
    for (const el of injected) el.remove();
    injected.length = 0;
  };
}

function collectSpecs(rows: PlannedRow[]): GapSpec[] {
  const out: GapSpec[] = [];
  for (const row of rows) {
    if (row.kind === "hunk-header" && row.gapAbove > 0) {
      out.push({ kind: "hunk-header", hunkIndex: row.hunkIndex, gapAbove: row.gapAbove });
    } else if (row.kind === "interactive" && row.subKind === "gap-mid-top") {
      // boundaryRef is `hunkIndex` for gap-mid-top (per diff-rows.ts).
      if (typeof row.boundaryRef === "number") {
        out.push({ kind: "gap-mid-top", hunkIndex: row.boundaryRef });
      }
    } else if (row.kind === "interactive" && row.subKind === "boundary-bottom") {
      out.push({ kind: "boundary-bottom" });
    }
  }
  return out;
}

function lastHunkIndexFromPlan(rows: PlannedRow[]): number {
  let last = 0;
  for (const row of rows) {
    if (row.kind === "hunk-header") last = row.hunkIndex;
  }
  return last;
}

function injectForSpec(args: {
  spec: GapSpec;
  block: HTMLElement;
  separators: HTMLElement[];
  lastHunkIndex: number;
  expandHunk: FileDiffRef["expandHunk"];
  onAfterExpand: () => void;
  injected: HTMLElement[];
  listeners: Array<{ el: HTMLElement; type: string; fn: EventListener }>;
}): void {
  const { spec, block, separators, lastHunkIndex, expandHunk, onAfterExpand, injected, listeners } = args;

  if (spec.kind === "hunk-header") {
    const sep = separators[spec.hunkIndex];
    if (!sep) return;
    if (sep.querySelector(':scope > [data-tour-interactive="gap-row"][data-subkind="hunk-header"]')) {
      return;
    }
    const direction = directionForHunkHeader(spec);
    const glyph = glyphForHunkHeader(spec);
    const node = createChevron({
      subKind: "hunk-header",
      hunkIndex: spec.hunkIndex,
      glyph,
    });
    sep.appendChild(node);
    injected.push(node);
    attachClick(node, listeners, (e) => {
      const count = e.shiftKey ? Math.max(spec.gapAbove, EXPANSION_STEP) : EXPANSION_STEP;
      expandHunk(spec.hunkIndex, direction, count);
      onAfterExpand();
    });
    return;
  }

  if (spec.kind === "gap-mid-top") {
    const sep = separators[spec.hunkIndex];
    if (!sep) return;
    const prev = sep.previousElementSibling;
    if (
      prev instanceof HTMLElement &&
      prev.dataset.tourInteractive === "gap-row" &&
      prev.dataset.subkind === "gap-mid-top" &&
      prev.dataset.hunkIndex === String(spec.hunkIndex)
    ) {
      return;
    }
    const node = createStandaloneRow({
      subKind: "gap-mid-top",
      hunkIndex: spec.hunkIndex,
      glyph: "↑",
    });
    sep.parentElement?.insertBefore(node, sep);
    injected.push(node);
    attachClick(node, listeners, (e) => {
      const count = e.shiftKey ? SHIFT_EXPAND_ALL : EXPANSION_STEP;
      expandHunk(spec.hunkIndex, "up", count);
      onAfterExpand();
    });
    return;
  }

  // boundary-bottom
  const lastLine = lastDataLineCell(block);
  if (!lastLine) return;
  const next = lastLine.nextElementSibling;
  if (
    next instanceof HTMLElement &&
    next.dataset.tourInteractive === "gap-row" &&
    next.dataset.subkind === "boundary-bottom"
  ) {
    return;
  }
  const node = createStandaloneRow({
    subKind: "boundary-bottom",
    glyph: "↓",
  });
  lastLine.parentElement?.insertBefore(node, lastLine.nextSibling);
  injected.push(node);
  attachClick(node, listeners, (e) => {
    const count = e.shiftKey ? SHIFT_EXPAND_ALL : EXPANSION_STEP;
    expandHunk(lastHunkIndex, "down", count);
    onAfterExpand();
  });
}

function directionForHunkHeader(spec: HunkHeaderSpec): "up" | "down" | "both" {
  if (spec.hunkIndex === 0) return "up";
  if (spec.gapAbove > GAP_TWO_ROW_THRESHOLD) return "down";
  return "both";
}

function glyphForHunkHeader(spec: HunkHeaderSpec): string {
  if (spec.hunkIndex === 0) return "↑";
  if (spec.gapAbove > GAP_TWO_ROW_THRESHOLD) return "↓";
  return "↕";
}

function lastDataLineCell(block: HTMLElement): HTMLElement | null {
  const cells = queryAllAcrossShadow(block, "[data-line]") as HTMLElement[];
  return cells.length === 0 ? null : cells[cells.length - 1];
}

function createChevron(args: {
  subKind: "hunk-header";
  hunkIndex: number;
  glyph: string;
}): HTMLElement {
  const node = document.createElement("button");
  node.type = "button";
  node.className = "tour-gap-chevron";
  node.dataset.tourInteractive = "gap-row";
  node.dataset.subkind = args.subKind;
  node.dataset.hunkIndex = String(args.hunkIndex);
  node.textContent = args.glyph;
  node.setAttribute("aria-label", "Expand hidden context");
  return node;
}

function createStandaloneRow(args: {
  subKind: "gap-mid-top" | "boundary-bottom";
  hunkIndex?: number;
  glyph: string;
}): HTMLElement {
  const node = document.createElement("div");
  node.className = "tour-gap-row";
  node.dataset.tourInteractive = "gap-row";
  node.dataset.subkind = args.subKind;
  if (args.hunkIndex !== undefined) node.dataset.hunkIndex = String(args.hunkIndex);
  node.setAttribute("role", "button");
  node.textContent = `${args.glyph} ··· expand ···`;
  return node;
}

function attachClick(
  el: HTMLElement,
  listeners: Array<{ el: HTMLElement; type: string; fn: EventListener }>,
  handler: (e: MouseEvent) => void,
): void {
  const fn: EventListener = (e) => {
    // Stop bubbling so a row-click on a `gap-mid-top` / `boundary-bottom`
    // doesn't also fire the file-block's wrapper click handler (which
    // would either toggle the file's collapse state on a header hit, or
    // re-seed the diff-row cursor at a stale anchor).
    e.stopPropagation();
    handler(e as MouseEvent);
  };
  el.addEventListener("click", fn);
  listeners.push({ el, type: "click", fn });
}
