import { useMemo } from "react";
import type { Annotation, Tour } from "./types.js";
import type { BundleFile, TourBundle } from "./tour-bundle.js";
import type { FileClassification } from "./file-classifier.js";
import type { FileContentPair } from "./file-content-provider.js";
import type { Cursor } from "./cursor-state.js";
import { resolveCursorRowIdx, validateCursor } from "./cursor-state.js";
import {
  buildTree,
  compress,
  flatten,
  sortFilesForStream,
  type FolderNode,
  type VisibleRow,
} from "./file-tree.js";
import { parseFileDiffMetadata, type FileDiffMetadata } from "./diff-model.js";
import { planRows, type PlannedRow } from "./diff-rows.js";
import { flatRows, type FlatRow } from "./flat-rows.js";
import {
  buildThreads,
  isTopLevel,
  topLevelAnnotations,
} from "./threads.js";
import type { Layout, TourSessionState, TourSessionStore } from "./tour-session.js";
import { useTourSession } from "./tour-session.js";
import { sendTarget, type SendTarget } from "./send-target.js";

// --- Slice shapes -----------------------------------------------------------

export interface BundleSlice {
  tour: Tour;
  annotations: ReadonlyArray<Annotation>;
  files: ReadonlyArray<BundleFile>;
  filesByName: ReadonlyMap<string, BundleFile>;
  classifications: Readonly<Record<string, FileClassification>>;
  fileContents: ReadonlyMap<string, FileContentPair>;
}

/** Nav fields that don't depend on the planner / cursor — exposed on both
 *  branches so snapshot-lost rendering can read top-level / replies / nav
 *  index without re-deriving them inline. */
export interface NavBase {
  topLevel: ReadonlyArray<Annotation>;
  repliesByRoot: ReadonlyMap<string, ReadonlyArray<Annotation>>;
  /** 1-based, top-level only — replies are absent from the map. */
  navIndexById: ReadonlyMap<string, number>;
  navTotal: number;
}

export interface NavSlice extends NavBase {
  /** 1-based index of the cursor's top-level Annotation when the cursor is
   *  on a card; 0 otherwise (null cursor, row cursor, card to deleted
   *  annotation). */
  currentIdx: number;
  /** Latest-human-leaf rule — null when the cursor isn't on a card, or
   *  the latest turn in the focused Thread is agent-authored. */
  sendTarget: SendTarget | null;
}

export interface RowsSlice {
  plannedRowsByFile: ReadonlyMap<string, ReadonlyArray<PlannedRow>>;
  flatRowsList: ReadonlyArray<FlatRow>;
  rowCount: number;
}

export interface TreeSlice {
  root: FolderNode<BundleFile>;
  visibleRows: ReadonlyArray<VisibleRow<BundleFile>>;
  /** Per-file top-level annotation count; folder rollup happens inside
   *  `flatten` so consumers reading `visibleRows` see folder totals. */
  annotationCounts: Readonly<Record<string, number>>;
}

export interface CursorSlice {
  /** state.cursor pruned against the live flatRowsList — a CardAnchor to a
   *  deleted annotation resolves to null; a RowAnchor in a folded-but-still-
   *  in-bundle file is preserved. */
  anchor: Cursor | null;
  onCard: boolean;
  onInteractive: boolean;
  cardId: string | null;
  cardAnnotation: Annotation | null;
  /** resolveCursorRowIdx(anchor, flatRowsList) — -1 when unresolved. */
  rowIdx: number;
}

export type TourSessionView =
  | {
      kind: "ok";
      bundle: BundleSlice;
      nav: NavSlice;
      rows: RowsSlice;
      tree: TreeSlice;
      cursor: CursorSlice;
    }
  | {
      kind: "snapshot-lost";
      tour: Tour;
      annotations: ReadonlyArray<Annotation>;
      /** NavBase populates on both branches (issue #246): snapshot-lost
       *  rendering reads top-level / replies / nav index from one place
       *  rather than re-deriving them inline. `currentIdx` / `sendTarget`
       *  stay ok-only (they depend on planner + cursor). */
      nav: NavBase;
    };

// --- Pure derivation --------------------------------------------------------

type OkBundle = Extract<TourBundle, { kind: "ok" }>;

function deriveBundleSlice(bundle: OkBundle): BundleSlice {
  const filesByName = new Map<string, BundleFile>();
  const classifications: Record<string, FileClassification> = {};
  const fileContents = new Map<string, FileContentPair>();
  for (const f of bundle.files) {
    filesByName.set(f.name, f);
    classifications[f.name] = f.classification;
    if (typeof f.oldContent === "string" && typeof f.newContent === "string") {
      fileContents.set(f.name, {
        oldContent: f.oldContent,
        newContent: f.newContent,
      });
    }
  }
  return {
    tour: bundle.tour,
    annotations: bundle.annotations,
    files: bundle.files,
    filesByName,
    classifications,
    fileContents,
  };
}

function deriveNavBase(annotations: ReadonlyArray<Annotation>): NavBase {
  const annArr = [...annotations];
  const topLevel = topLevelAnnotations(annArr);
  const navIndexById = new Map<string, number>();
  topLevel.forEach((a, i) => navIndexById.set(a.id, i + 1));
  const repliesByRoot = new Map<string, ReadonlyArray<Annotation>>();
  for (const t of buildThreads(annArr)) {
    repliesByRoot.set(t.root.id, t.replies);
  }
  return {
    topLevel,
    repliesByRoot,
    navIndexById,
    navTotal: topLevel.length,
  };
}

function deriveNavSlice(
  base: NavBase,
  cursor: Cursor | null,
): NavSlice {
  let currentIdx = 0;
  if (cursor && cursor.kind === "card") {
    const idx = base.topLevel.findIndex((a) => a.id === cursor.annotationId);
    if (idx !== -1) currentIdx = idx + 1;
  }
  const target = sendTarget(cursor, base.topLevel, base.repliesByRoot);
  return {
    ...base,
    currentIdx,
    sendTarget: target,
  };
}

function deriveTreeSlice(
  files: ReadonlyArray<BundleFile>,
  collapsedFolders: ReadonlySet<string>,
  annotations: ReadonlyArray<Annotation>,
): TreeSlice {
  const root = compress(buildTree([...files]));
  const annotationCounts: Record<string, number> = {};
  for (const a of annotations) {
    if (!isTopLevel(a)) continue;
    annotationCounts[a.file] = (annotationCounts[a.file] ?? 0) + 1;
  }
  const visibleRows = flatten(root, collapsedFolders, annotationCounts);
  return { root, visibleRows, annotationCounts };
}

function deriveRowsSlice(
  bundle: OkBundle,
  state: TourSessionState,
  parsedFiles: ReadonlyArray<FileDiffMetadata>,
): RowsSlice {
  const filesByName = new Map<string, BundleFile>();
  for (const f of bundle.files) filesByName.set(f.name, f);
  const annotations = bundle.annotations;
  const { expansion, collapsedOverrides, layout } = state;

  const isClassifierCollapsed = (name: string): boolean => {
    const override = collapsedOverrides[name];
    if (override === false) return false;
    const bf = filesByName.get(name);
    if (!bf) return false;
    if (!bf.classification.collapsed) return false;
    if (bf.classification.reason === "binary") return false;
    return true;
  };
  // Binary files are body-collapsed entirely (no synthetic row); user
  // overrides win. Matches the TUI's slice-1-canonical `isFileCollapsed`
  // — the webapp's slice-3 migration reconciles its `defaultCollapsedFor`
  // through this same rule.
  const isFileFolded = (name: string): boolean => {
    const override = collapsedOverrides[name];
    if (override !== undefined) return override;
    const bf = filesByName.get(name);
    if (!bf) return false;
    return bf.classification.reason === "binary";
  };

  const plannedRowsByFile = new Map<string, PlannedRow[]>();
  for (const f of parsedFiles) {
    const bf = filesByName.get(f.name);
    const fileAnns = annotations.filter((a) => a.file === f.name);
    plannedRowsByFile.set(
      f.name,
      planRows(f, fileAnns, layout, {
        oldContent: bf?.oldContent,
        newContent: bf?.newContent,
        expansion,
        classifierCollapsed: isClassifierCollapsed(f.name),
      }),
    );
  }

  // flatRows iterates the (sorted) parsed-file list and skips folded files;
  // it only needs `{name}` from each DiffFile-shaped entry. Mirror the
  // webapp's `parsedFiles.map(...)` adapter so both surfaces' slice-2/3
  // migrations land on the same iteration order.
  const flatRowsList = flatRows(
    parsedFiles.map((f) => ({ name: f.name, type: "change", hunks: [] })),
    plannedRowsByFile,
    isFileFolded,
  );

  return {
    plannedRowsByFile,
    flatRowsList,
    rowCount: flatRowsList.length,
  };
}

function deriveCursorSlice(
  cursor: Cursor | null,
  flatRowsList: ReadonlyArray<FlatRow>,
  files: ReadonlyArray<BundleFile>,
  annotations: ReadonlyArray<Annotation>,
): CursorSlice {
  const flatRowsArr = [...flatRowsList];
  const anchor = validateCursor(cursor, flatRowsArr, files);
  const onCard = anchor !== null && anchor.kind === "card";
  const onInteractive =
    anchor !== null && anchor.kind === "row" && !!anchor.interactive;
  const cardId =
    anchor !== null && anchor.kind === "card" ? anchor.annotationId : null;
  const cardAnnotation =
    cardId !== null ? annotations.find((a) => a.id === cardId) ?? null : null;
  const rowIdx = resolveCursorRowIdx(anchor, flatRowsArr);
  return { anchor, onCard, onInteractive, cardId, cardAnnotation, rowIdx };
}

/**
 * Pure projection from `(TourBundle, TourSessionState)` to the rendered
 * shape both surfaces consume (PRD #242, issue #243). Discriminated by
 * `kind`: snapshot-lost short-circuits to a banner-only view; ok carries
 * the five namespaces. No React, no DOM — testable as pure data.
 */
export function deriveTourSessionView(
  bundle: TourBundle,
  state: TourSessionState,
): TourSessionView {
  const navBase = deriveNavBase(bundle.annotations);
  if (bundle.kind === "snapshot-lost") {
    return {
      kind: "snapshot-lost",
      tour: bundle.tour,
      annotations: bundle.annotations,
      nav: navBase,
    };
  }
  const bundleSlice = deriveBundleSlice(bundle);
  const navSlice = deriveNavSlice(navBase, state.cursor);
  const treeSlice = deriveTreeSlice(
    bundle.files,
    state.collapsedFolders,
    bundle.annotations,
  );
  const parsedFiles = sortFilesForStream(parseFileDiffMetadata(bundle.diff));
  const rowsSlice = deriveRowsSlice(bundle, state, parsedFiles);
  const cursorSlice = deriveCursorSlice(
    state.cursor,
    rowsSlice.flatRowsList,
    bundle.files,
    bundle.annotations,
  );
  return {
    kind: "ok",
    bundle: bundleSlice,
    nav: navSlice,
    rows: rowsSlice,
    tree: treeSlice,
    cursor: cursorSlice,
  };
}

// --- React hook -------------------------------------------------------------

/**
 * Per-namespace `useMemo` wrapper around `deriveTourSessionView`. Granular
 * invalidation survives the move from the two Apps' parallel `useMemo`
 * chains (cursor moves don't blow away the planner cache; fold toggles
 * don't re-run threads). Surfaces consume the view as
 * `const view = useTourSessionView(store, bundle)` once at App root and
 * pass slices via props.
 */
export function useTourSessionView(
  store: TourSessionStore,
  bundle: TourBundle,
): TourSessionView {
  const state = useTourSession(store);
  const annotations: ReadonlyArray<Annotation> = bundle.annotations;
  const cursor = state.cursor;
  const isOk = bundle.kind === "ok";

  const navBase = useMemo<NavBase>(
    () => deriveNavBase(annotations),
    [annotations],
  );

  const bundleSlice = useMemo<BundleSlice | null>(
    () => (isOk ? deriveBundleSlice(bundle) : null),
    [bundle, isOk],
  );

  const navSlice = useMemo<NavSlice | null>(
    () => (isOk ? deriveNavSlice(navBase, cursor) : null),
    [isOk, navBase, cursor],
  );

  const treeSlice = useMemo<TreeSlice | null>(
    () =>
      isOk
        ? deriveTreeSlice(
            (bundle as OkBundle).files,
            state.collapsedFolders,
            annotations,
          )
        : null,
    [isOk, bundle, state.collapsedFolders, annotations],
  );

  const parsedFiles = useMemo<ReadonlyArray<FileDiffMetadata>>(
    () =>
      isOk ? sortFilesForStream(parseFileDiffMetadata((bundle as OkBundle).diff)) : [],
    [isOk, bundle],
  );

  const rowsSlice = useMemo<RowsSlice | null>(
    () => (isOk ? deriveRowsSlice(bundle as OkBundle, state, parsedFiles) : null),
    // Only the three fields `deriveRowsSlice` reads — listing `state` here
    // would defeat granular invalidation (cursor moves would bust the
    // planner cache).
    [
      isOk,
      bundle,
      state.expansion,
      state.collapsedOverrides,
      state.layout,
      parsedFiles,
    ],
  );

  const cursorSlice = useMemo<CursorSlice | null>(
    () =>
      isOk && rowsSlice
        ? deriveCursorSlice(
            cursor,
            rowsSlice.flatRowsList,
            (bundle as OkBundle).files,
            annotations,
          )
        : null,
    [isOk, cursor, rowsSlice, bundle, annotations],
  );

  if (!isOk) {
    return {
      kind: "snapshot-lost",
      tour: bundle.tour,
      annotations: bundle.annotations,
      nav: navBase,
    };
  }
  return {
    kind: "ok",
    bundle: bundleSlice!,
    nav: navSlice!,
    rows: rowsSlice!,
    tree: treeSlice!,
    cursor: cursorSlice!,
  };
}

// Re-export so callers can pick up the canonical SendTarget through the view
// module (slice 2/3 will switch consumers to `view.nav.sendTarget`).
export type { SendTarget };
export type { Layout };
