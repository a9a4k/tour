import { useEffect, useMemo, useRef, useState } from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer } from "@opentui/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { Tour, Annotation } from "../core/types.js";
import type { DiffFile, FileDiffMetadata } from "../core/diff-model.js";
import { parseFileDiffMetadata } from "../core/diff-model.js";
import type { PlannedRow } from "../core/diff-rows.js";
import { planRows } from "../core/diff-rows.js";
import { DiffRows } from "./DiffRows.js";
import type { FileClassification } from "../core/file-classifier.js";
import {
  buildTree,
  compress,
  flatten,
  revealAncestors,
  revealAndLocate,
  sortFilesForStream,
  type VisibleRow,
} from "../core/file-tree.js";
import { buildPickerRows, type PickerRow } from "../core/tour-list.js";
import { theme } from "../core/theme.js";
import { dispatchKey } from "./keymap.js";
import { TourPicker } from "./TourPicker.js";
import { TopHeaderTui } from "./TopHeader.js";
import { Composer } from "./Composer.js";
import {
  buildReplyComposer,
  buildTopLevelComposer,
  type ComposerState,
} from "./composer-state.js";
import { isTopLevel, topLevelAnnotations } from "../core/threads.js";
import { TourWatcher } from "../core/watcher.js";
import { ReplyRunner } from "../core/reply-runner.js";
import type { ReplyLock } from "../core/reply-lock.js";
import { flatRows, type FlatRow } from "../core/flat-rows.js";
import {
  initialCursor,
  moveCursor,
  setCursorSide,
  validateCursor,
  cursorFromAnnotation,
  cursorAtFirstFileRow,
  type Cursor,
} from "../core/cursor-state.js";

function initialPickerCursor(rows: PickerRow[], currentId: string): number {
  if (rows.length === 0) return 0;
  const idx = rows.findIndex((r) => r.id !== currentId);
  return idx === -1 ? 0 : idx;
}

export interface TourBundle {
  tour: Tour;
  diff: string;
  files: DiffFile[];
  annotations: Annotation[];
  snapshotLost: boolean;
  classifications: Record<string, FileClassification>;
  replyLock: ReplyLock | null;
}

export type WriteAnnotationInput =
  | {
      kind: "top-level";
      file: string;
      side: "additions" | "deletions";
      line_start: number;
      line_end: number;
      body: string;
    }
  | { kind: "reply"; parent: Annotation; body: string };

interface AppProps {
  tour: Tour;
  diff: string;
  files: DiffFile[];
  annotations: Annotation[];
  snapshotLost: boolean;
  classifications?: Record<string, FileClassification>;
  replyLock?: ReplyLock | null;
  loadTour?: (id: string) => Promise<TourBundle>;
  loadTours?: () => Promise<{ tours: Tour[]; annotationCounts: Record<string, number> }>;
  writeAnnotation?: (tourId: string, input: WriteAnnotationInput) => Promise<Annotation>;
  cwd?: string;
  replyAgent?: string;
}

function statusIcon(type: string): string {
  switch (type) {
    case "new":
    case "add": return "A";
    case "delete": return "D";
    case "rename": return "R";
    case "change": return "M";
    default: return "M";
  }
}

function annotationCountForFile(annotations: Annotation[], fileName: string): number {
  return annotations.filter((a) => a.file === fileName && isTopLevel(a)).length;
}

function fileClassification(classifications: Record<string, FileClassification> | undefined, fileName: string): FileClassification {
  return classifications?.[fileName] ?? { collapsed: false };
}

function reasonLabel(reason?: string): string {
  if (!reason) return "";
  return ` [${reason}]`;
}

function fileEntryLabel(
  file: DiffFile,
  classifications: Record<string, FileClassification> | undefined,
  annotations: Annotation[],
): string {
  const annCount = annotationCountForFile(annotations, file.name);
  const cls = fileClassification(classifications, file.name);
  const icon = statusIcon(file.type);
  const badge = annCount > 0 ? ` [${annCount}]` : "";
  const marker = cls.reason ? reasonLabel(cls.reason) : "";
  return ` ${icon} ${file.name}${marker}${badge} `;
}

function fileCardBody(
  fileName: string,
  collapsed: boolean,
  hasHunks: boolean,
  rows: PlannedRow[],
  layout: "split" | "unified",
  currentAnnotationId: string | null,
  cursor: Cursor | null,
  onCursorClick: (
    file: string,
    side: "additions" | "deletions",
    lineNumber: number,
  ) => void,
  repliesCollapsed: boolean,
  replyLock: ReplyLock | null,
  now: number,
) {
  if (collapsed) return <text fg={theme.fg.muted}>{"[collapsed — c to expand]"}</text>;
  if (!hasHunks) return <text fg={theme.fg.muted}>{"[no textual changes]"}</text>;
  return (
    <DiffRows
      fileName={fileName}
      rows={rows}
      layout={layout}
      currentAnnotationId={currentAnnotationId}
      cursor={cursor}
      onCursorClick={onCursorClick}
      repliesCollapsed={repliesCollapsed}
      replyLock={replyLock}
      now={now}
    />
  );
}

function folderRowLabel(row: Extract<VisibleRow<DiffFile>, { kind: "folder" }>): string {
  const indent = "  ".repeat(row.depth);
  const caret = row.collapsed ? "▸" : "▾";
  return ` ${indent}${caret} ${row.displayName} `;
}

function fileRowLabel(row: Extract<VisibleRow<DiffFile>, { kind: "file" }>): string {
  const indent = "  ".repeat(row.depth);
  const icon = statusIcon(row.file.type);
  const badge = row.annotationCount > 0 ? ` [${row.annotationCount}]` : "";
  return ` ${indent}${icon} ${row.displayName}${badge} `;
}

function App(props: AppProps) {
  const [bundle, setBundle] = useState<TourBundle>({
    tour: props.tour,
    diff: props.diff,
    files: props.files,
    annotations: props.annotations,
    snapshotLost: props.snapshotLost,
    classifications: props.classifications ?? {},
    replyLock: props.replyLock ?? null,
  });
  const [selectedRowIdx, setSelectedRowIdx] = useState(0);
  const [sidebarFocused, setSidebarFocused] = useState(true);
  const [collapsedOverrides, setCollapsedOverrides] = useState<Record<string, boolean>>({});
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const [currentAnnotationId, setCurrentAnnotationId] = useState<string | null>(null);
  const [layout, setLayout] = useState<"split" | "unified">("split");
  const [repliesCollapsed, setRepliesCollapsed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerCursor, setPickerCursor] = useState(0);
  const [pickerTours, setPickerTours] = useState<Tour[]>([]);
  const [pickerCounts, setPickerCounts] = useState<Record<string, number>>({});
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const renderer = useRenderer();
  const diffScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const sidebarScrollRef = useRef<ScrollBoxRenderable | null>(null);
  // Seeded-once-per-tour guard for currentAnnotationId. Without it, opening
  // an empty Tour and pressing `a` would auto-advance currentAnnotationId
  // to the freshly-typed annotation (so a subsequent `r` would reply to
  // your own thing). The cursor stays where it was; the annotation focus
  // ring should too.
  const seededTourIdRef = useRef<string | null>(null);

  const liveTour = bundle.tour;
  const liveAnnotations = bundle.annotations;
  const liveDiff = bundle.diff;
  const liveSnapshotLost = bundle.snapshotLost;
  const liveClassifications = bundle.classifications;
  const liveReplyLock = bundle.replyLock;
  const liveTopLevel = useMemo(() => topLevelAnnotations(liveAnnotations), [liveAnnotations]);

  // Wall clock used by the in-flight pill to render "(Ns)". Ticks once per
  // second only when a lock is present so we don't burn renders on the idle
  // path.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!liveReplyLock) return;
    const handle = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(handle);
  }, [liveReplyLock]);

  // Per-tour file watcher: drives both the bundle reload (so newly-written
  // Annotations and lock-state changes show up) and the reply-agent runner
  // (so a human-authored Annotation kicks off a dispatch). Inert when no
  // loadTour is wired.
  useEffect(() => {
    if (!props.cwd || !props.loadTour) return;
    const watcher = new TourWatcher(props.cwd, liveTour.id);
    const runner = props.replyAgent
      ? new ReplyRunner({ cwd: props.cwd, tourId: liveTour.id, agent: props.replyAgent })
      : null;
    if (runner) void runner.prime();

    let cancelled = false;
    const reload = async () => {
      if (!props.loadTour || cancelled) return;
      try {
        const next = await props.loadTour(liveTour.id);
        if (!cancelled) setBundle(next);
      } catch {
        // transient — keep current bundle
      }
    };

    watcher.on((event) => {
      if (event.type === "annotation-changed") {
        if (runner) void runner.tick().catch(() => {});
        void reload();
      } else if (event.type === "reply-in-flight" || event.type === "reply-cleared") {
        void reload();
      }
    });
    watcher.start();

    return () => {
      cancelled = true;
      watcher.stop();
    };
  }, [liveTour.id, props.cwd, props.replyAgent, props.loadTour]);

  const files = useMemo(
    () => sortFilesForStream(bundle.files),
    [bundle.files],
  );

  const tree = useMemo(() => compress(buildTree(bundle.files)), [bundle.files]);

  const annotationCounts = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const a of liveAnnotations) {
      out[a.file] = (out[a.file] ?? 0) + 1;
    }
    return out;
  }, [liveAnnotations]);

  const visibleRows = useMemo<VisibleRow<DiffFile>[]>(
    () => flatten(tree, collapsedFolders, annotationCounts),
    [tree, collapsedFolders, annotationCounts],
  );

  const safeRowIdx = visibleRows.length === 0
    ? 0
    : Math.min(Math.max(0, selectedRowIdx), visibleRows.length - 1);
  const selectedRow: VisibleRow<DiffFile> | undefined = visibleRows[safeRowIdx];

  const fileMetadata = useMemo(() => {
    const out = new Map<string, FileDiffMetadata>();
    for (const meta of parseFileDiffMetadata(liveDiff)) out.set(meta.name, meta);
    return out;
  }, [liveDiff]);

  const plannedRowsByFile = useMemo(() => {
    const out = new Map<string, PlannedRow[]>();
    for (const [name, meta] of fileMetadata) {
      const fileAnns = liveAnnotations.filter((a) => a.file === name);
      out.set(name, planRows(meta, fileAnns, layout));
    }
    return out;
  }, [fileMetadata, liveAnnotations, layout]);

  const isFileCollapsed = (fileName: string): boolean => {
    const override = collapsedOverrides[fileName];
    if (override !== undefined) return override;
    const cls = fileClassification(liveClassifications, fileName);
    if (!cls.collapsed) return false;
    if (cls.reason === "binary") return true;
    const hasAnnotations = liveAnnotations.some((a) => a.file === fileName);
    if (hasAnnotations) return false;
    return true;
  };

  // Cross-file flat row sequence the line cursor walks (ADR 0011). Skips
  // hunk-headers, annotation rows, and folded files. Re-derives whenever
  // the underlying diff, layout, or fold state changes — the cursor's
  // anchor is invariant across this re-derivation; only its resolved
  // viewport index moves.
  const flatRowsList = useMemo<FlatRow[]>(
    () => flatRows(files, plannedRowsByFile, isFileCollapsed),
    // isFileCollapsed is a fresh closure per render but its observable
    // output is fully determined by the listed state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [files, plannedRowsByFile, collapsedOverrides, liveClassifications, liveAnnotations],
  );

  // Seed currentAnnotationId once per tour: on tour-open with annotations,
  // land on the first top-level Annotation (preserves today's UX). After
  // seeding, the user owns it — pressing `a` to add a new Annotation does
  // NOT auto-advance currentAnnotationId to the new one (PRD UX 26: a
  // follow-up `r` would otherwise reply to your own freshly-typed thing).
  // Tour-switch resets the ref so the next tour seeds on its own terms.
  useEffect(() => {
    if (seededTourIdRef.current !== liveTour.id) {
      seededTourIdRef.current = liveTour.id;
      if (liveTopLevel.length === 0) {
        if (currentAnnotationId !== null) setCurrentAnnotationId(null);
        return;
      }
      const first = liveTopLevel[0];
      setCurrentAnnotationId(first.id);
      const located = revealAndLocate(tree, collapsedFolders, annotationCounts, first.file);
      if (!located) return;
      if (located.collapsedFolders !== collapsedFolders) {
        setCollapsedFolders(located.collapsedFolders as Set<string>);
      }
      setSelectedRowIdx(located.rowIdx);
      return;
    }
    // Already seeded for this tour: only invalidate when the current id
    // disappears (e.g. agent removed an annotation).
    if (
      currentAnnotationId !== null &&
      !liveTopLevel.some((a) => a.id === currentAnnotationId)
    ) {
      setCurrentAnnotationId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveTopLevel, liveTour.id]);

  // Validate the line cursor in place when the row sequence shifts under
  // it (fold toggle, bundle reload, layout change). The anchor is
  // preserved when it still resolves; when its row vanishes it snaps to
  // the file's first remaining row; when the file is gone the cursor
  // goes null and re-materializes lazily on next interaction. Lazy
  // materialization rule (ADR 0011 Revisions): we never seed here —
  // first j/k/h/l/arrows/a/n/p/click does, via the handlers below.
  useEffect(() => {
    if (cursor === null) return;
    // Pass `files` so validateCursor can snap to the next file in stream
    // order when the cursor's file was folded out. Without `files` it
    // would null out instead of advancing.
    const validated = validateCursor(cursor, flatRowsList, files);
    if (validated !== cursor) setCursor(validated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatRowsList, liveTopLevel]);

  // Keep the line cursor's row visible: every cursor mutation asks the
  // scrollbox to scroll the row into view (block:nearest semantics so an
  // already-visible row doesn't move). Side toggle on a paired row is a
  // no-op vertically and a no-op-or-nudge horizontally per scrollbox
  // semantics. `layout` is in deps so a Shift-L flip — which preserves the
  // anchor but moves the visual position — re-fires the scroll.
  useEffect(() => {
    if (!diffScrollRef.current || !cursor) return;
    diffScrollRef.current.scrollChildIntoView(
      `diff-row-${cursor.file}-${cursor.side}-${cursor.lineNumber}`,
    );
  }, [cursor, layout]);

  // Sidebar follows the cursor's file. Deps are `[cursor?.file]` (not
  // `[cursor]`) so in-file j/k motion leaves the sidebar untouched —
  // sidebar selection is a per-file affordance, not a per-row one.
  useEffect(() => {
    if (!cursor) return;
    const located = revealAndLocate(tree, collapsedFolders, annotationCounts, cursor.file);
    if (!located) return;
    if (located.collapsedFolders !== collapsedFolders) {
      setCollapsedFolders(located.collapsedFolders as Set<string>);
    }
    if (located.rowIdx !== safeRowIdx) {
      setSelectedRowIdx(located.rowIdx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor?.file]);

  // Keep the selected sidebar row visible: whenever the row index or the row
  // list changes, ask the scrollbox to scroll the row into view (block:nearest
  // semantics — already-visible rows don't move).
  useEffect(() => {
    const row = visibleRows[safeRowIdx];
    if (!row || !sidebarScrollRef.current) return;
    sidebarScrollRef.current.scrollChildIntoView(`row-${row.path}`);
  }, [safeRowIdx, visibleRows]);

  // Keep the current annotation card in the diff-pane viewport. Fires only
  // when the current annotation id (or the underlying diff content) changes,
  // so manual scrolling between transitions is preserved. Falls back to the
  // file card when the annotation card itself can't be located (e.g. the
  // annotation's anchor row isn't in any hunk).
  useEffect(() => {
    if (!diffScrollRef.current || !currentAnnotationId) return;
    const ann = liveAnnotations.find((a) => a.id === currentAnnotationId);
    if (!ann) return;
    diffScrollRef.current.scrollChildIntoView(`annotation-${ann.id}`);
  }, [currentAnnotationId, liveAnnotations, plannedRowsByFile]);

  const currentAnnotationIdx = useMemo(() => {
    if (liveTopLevel.length === 0) return -1;
    if (currentAnnotationId === null) return 0;
    const idx = liveTopLevel.findIndex((a) => a.id === currentAnnotationId);
    return idx === -1 ? 0 : idx;
  }, [liveTopLevel, currentAnnotationId]);

  const footerHints =
    "j/k: move  ·  h/l: side  ·  n/p: nav  ·  a: annotate  ·  r: reply  ·  c: collapse  ·  Space: page  ·  L: layout  ·  t: picker  ·  Tab: pane  ·  q: quit";
  const footer =
    liveTopLevel.length > 0
      ? `Annotation ${currentAnnotationIdx + 1}/${liveTopLevel.length}  ·  ${footerHints}`
      : footerHints;

  const pickerRows = useMemo(
    () =>
      buildPickerRows({
        tours: pickerTours,
        annotationCounts: pickerCounts,
        now: Date.now(),
      }),
    [pickerTours, pickerCounts],
  );

  const openPicker = async () => {
    if (pickerOpen) return;
    if (props.loadTours) {
      try {
        const { tours, annotationCounts: counts } = await props.loadTours();
        setPickerTours(tours);
        setPickerCounts(counts);
        const rows = buildPickerRows({ tours, annotationCounts: counts, now: Date.now() });
        setPickerCursor(initialPickerCursor(rows, liveTour.id));
      } catch {
        setPickerTours([]);
        setPickerCounts({});
        setPickerCursor(0);
      }
    } else {
      setPickerCursor(initialPickerCursor(pickerRows, liveTour.id));
    }
    setPickerOpen(true);
  };

  const closePicker = () => {
    setPickerOpen(false);
  };

  const commitTour = async (id: string) => {
    if (!props.loadTour) {
      closePicker();
      return;
    }
    if (id === liveTour.id) {
      closePicker();
      return;
    }
    try {
      const next = await props.loadTour(id);
      setBundle(next);
      setSelectedRowIdx(0);
      setCurrentAnnotationId(null);
      setCursor(null);
      setCollapsedOverrides({});
      setCollapsedFolders(new Set());
    } finally {
      closePicker();
    }
  };

  const jumpToAnnotation = (ann: Annotation) => {
    setCurrentAnnotationId(ann.id);
    const located = revealAndLocate(tree, collapsedFolders, annotationCounts, ann.file);
    if (located) {
      if (located.collapsedFolders !== collapsedFolders) {
        setCollapsedFolders(located.collapsedFolders as Set<string>);
      }
      if (located.rowIdx !== safeRowIdx) {
        setSelectedRowIdx(located.rowIdx);
      }
    }
    setCollapsedOverrides((prev) => ({ ...prev, [ann.file]: false }));
    // β-coupling per ADR 0011: annotation-nav also moves the line cursor.
    // Reverse direction (`j`/`k`) stays decoupled.
    setCursor(cursorFromAnnotation(ann));
  };

  const gotoPrevAnnotation = () => {
    if (currentAnnotationIdx <= 0) return;
    jumpToAnnotation(liveTopLevel[currentAnnotationIdx - 1]);
  };

  const gotoNextAnnotation = () => {
    if (currentAnnotationIdx < 0) return;
    if (currentAnnotationIdx >= liveTopLevel.length - 1) return;
    jumpToAnnotation(liveTopLevel[currentAnnotationIdx + 1]);
  };

  // Mouse click on a diff row → set cursor + side per the click site (issue
  // #104). Side derivation lives in DiffRows.tsx (it's UI-coordinate-
  // dependent). Sets preferredSide to the clicked side so subsequent
  // keyboard motion preserves the user's mouse-expressed preference.
  // Also focuses the diff pane and syncs the sidebar selection so cross-
  // file consistency matches keyboard motion.
  const onCursorClick = (
    file: string,
    side: "additions" | "deletions",
    lineNumber: number,
  ) => {
    setSidebarFocused(false);
    setCursor({ file, lineNumber, side, preferredSide: side });
    const located = revealAndLocate(tree, collapsedFolders, annotationCounts, file);
    if (located) {
      if (located.collapsedFolders !== collapsedFolders) {
        setCollapsedFolders(located.collapsedFolders as Set<string>);
      }
      if (located.rowIdx !== safeRowIdx) {
        setSelectedRowIdx(located.rowIdx);
      }
    }
  };

  // Lazy materialization (ADR 0011 Revisions). Returns the seeded
  // cursor (or the existing one if already materialized) so the caller
  // can chain into composer-open / motion in one step. setCursor is
  // queued, so the returned value is what the caller should act on
  // this tick. Surface parity with src/web/client/App.tsx.
  const materializeCursor = (): Cursor | null => {
    if (cursor) return cursor;
    const seeded = initialCursor({
      topLevelAnnotations: liveTopLevel,
      flatRows: flatRowsList,
    });
    if (seeded) setCursor(seeded);
    return seeded;
  };

  const openTopLevelComposer = () => {
    const activeCursor = materializeCursor();
    const currentAnn =
      liveAnnotations.find((a) => a.id === currentAnnotationId) ?? null;
    const state = buildTopLevelComposer({
      cursor: activeCursor,
      currentAnnotation: currentAnn,
    });
    if (!state) return;
    setComposer(state);
  };

  const openReplyComposer = () => {
    const currentAnn =
      liveAnnotations.find((a) => a.id === currentAnnotationId) ?? null;
    const state = buildReplyComposer({ currentAnnotation: currentAnn });
    if (!state) return;
    setComposer(state);
  };

  const cancelComposer = () => {
    setComposer(null);
  };

  const submitComposer = async (body: string) => {
    if (!composer) return;
    const trimmed = body.trim();
    // Empty submissions are silently treated as cancel — no zero-length notes.
    if (trimmed.length === 0 || !props.writeAnnotation) {
      setComposer(null);
      return;
    }
    try {
      if (composer.kind === "top-level") {
        await props.writeAnnotation(liveTour.id, {
          kind: "top-level",
          file: composer.file,
          side: composer.side,
          line_start: composer.line_start,
          line_end: composer.line_end,
          body: trimmed,
        });
      } else {
        await props.writeAnnotation(liveTour.id, {
          kind: "reply",
          parent: composer.parent,
          body: trimmed,
        });
      }
      // The CLI's `tour annotate` would let the watcher re-render. The TUI
      // path skips the watcher loop and reloads the bundle directly so the
      // new entry shows up immediately on submit.
      if (props.loadTour) {
        const refreshed = await props.loadTour(liveTour.id);
        setBundle(refreshed);
      }
    } finally {
      setComposer(null);
    }
  };

  useKeyboard((key) => {
    if (composer) {
      // Esc cancels; Return / typing flows through to the focused <input>.
      if (key.name === "escape") {
        cancelComposer();
      }
      return;
    }
    if (pickerOpen) {
      if (key.ctrl || key.shift) return;
      if (key.name === "escape" || key.name === "t") {
        closePicker();
        return;
      }
      if (key.name === "j" || key.name === "down") {
        setPickerCursor((c) => Math.min(pickerRows.length - 1, c + 1));
        return;
      }
      if (key.name === "k" || key.name === "up") {
        setPickerCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.name === "return") {
        const r = pickerRows[pickerCursor];
        if (r) void commitTour(r.id);
        return;
      }
      return;
    }

    const action = dispatchKey(
      { name: key.name, ctrl: key.ctrl, shift: key.shift },
      {
        sidebarFocused,
        rowCount: visibleRows.length,
        selectedRowKind: selectedRow?.kind ?? null,
      },
    );

    // Lazy materialization (ADR 0011 Revisions): the first j/k/h/l/arrow
    // interaction with a null cursor SHOWS the cursor at the default
    // target without moving past it. `a` materializes AND opens the
    // composer in one step; n/p materialize via β-coupling inside
    // jumpToAnnotation. Degraded states (no rows) yield null and the
    // motion is a silent no-op.
    const isMotion =
      action.type === "cursor-down" ||
      action.type === "cursor-up" ||
      action.type === "cursor-side-left" ||
      action.type === "cursor-side-right";
    if (isMotion && cursor === null) {
      materializeCursor();
      return;
    }

    switch (action.type) {
      case "quit":
        renderer.destroy();
        return;
      case "toggle-pane":
        setSidebarFocused((v) => !v);
        return;
      case "focus-sidebar":
        setSidebarFocused(true);
        return;
      case "move-file-down":
        setSelectedRowIdx((i) => Math.min(i + 1, visibleRows.length - 1));
        return;
      case "move-file-up":
        setSelectedRowIdx((i) => Math.max(i - 1, 0));
        return;
      case "select-file": {
        if (selectedRow?.kind !== "file") return;
        setSidebarFocused(false);
        if (diffScrollRef.current) {
          diffScrollRef.current.scrollChildIntoView(`file-card-${selectedRow.path}`);
        }
        // PRD US 20: explicit sidebar-driven file selection moves the
        // cursor to that file's first annotatable row. Folded files
        // contribute no rows so cursor goes null. currentAnnotationId is
        // unchanged — annotation focus is independent of code-reading
        // position.
        setCursor(cursorAtFirstFileRow(selectedRow.path, flatRowsList));
        return;
      }
      case "toggle-collapse": {
        if (selectedRow?.kind !== "file") return;
        const f = selectedRow.file;
        const cls = fileClassification(liveClassifications, f.name);
        if (cls.reason === "binary") return;
        setCollapsedOverrides((prev) => ({
          ...prev,
          [f.name]: !isFileCollapsed(f.name),
        }));
        return;
      }
      case "toggle-folder": {
        if (selectedRow?.kind !== "folder") return;
        const path = selectedRow.path;
        setCollapsedFolders((prev) => {
          const next = new Set(prev);
          if (next.has(path)) next.delete(path);
          else next.add(path);
          return next;
        });
        return;
      }
      case "expand-folder": {
        if (selectedRow?.kind !== "folder") return;
        const path = selectedRow.path;
        setCollapsedFolders((prev) => {
          if (!prev.has(path)) return prev;
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
        return;
      }
      case "collapse-folder": {
        if (selectedRow?.kind !== "folder") return;
        const path = selectedRow.path;
        setCollapsedFolders((prev) => {
          if (prev.has(path)) return prev;
          const next = new Set(prev);
          next.add(path);
          return next;
        });
        return;
      }
      case "collapse-parent": {
        if (selectedRow?.kind !== "file") return;
        const ancestors = revealAncestors(tree, selectedRow.path);
        if (ancestors.length === 0) return;
        const parentPath = ancestors[ancestors.length - 1];
        const nextCollapsed = new Set(collapsedFolders);
        nextCollapsed.add(parentPath);
        const nextRows = flatten(tree, nextCollapsed, annotationCounts);
        const newIdx = nextRows.findIndex((r) => r.path === parentPath);
        setCollapsedFolders(nextCollapsed);
        if (newIdx >= 0) setSelectedRowIdx(newIdx);
        return;
      }
      case "next-annotation":
        gotoNextAnnotation();
        return;
      case "prev-annotation":
        gotoPrevAnnotation();
        return;
      case "toggle-replies-collapse":
        setRepliesCollapsed((v) => !v);
        return;
      case "toggle-layout":
        setLayout((v) => (v === "split" ? "unified" : "split"));
        return;
      case "open-picker":
        void openPicker();
        return;
      case "open-top-level-composer":
        openTopLevelComposer();
        return;
      case "open-reply-composer":
        openReplyComposer();
        return;
      case "page-diff-down":
        diffScrollRef.current?.scrollBy(1, "viewport");
        return;
      case "page-diff-up":
        diffScrollRef.current?.scrollBy(-1, "viewport");
        return;
      case "cursor-down":
        setCursor((c) => moveCursor(c, "down", flatRowsList));
        return;
      case "cursor-up":
        setCursor((c) => moveCursor(c, "up", flatRowsList));
        return;
      case "cursor-side-left":
        setCursor((c) => setCursorSide(c, "deletions", flatRowsList));
        return;
      case "cursor-side-right":
        setCursor((c) => setCursorSide(c, "additions", flatRowsList));
        return;
    }
  });

  return (
    <box width="100%" height="100%" flexDirection="column">
      <TopHeaderTui
        tour={liveTour}
        layout={layout}
        currentAnnotationIdx={currentAnnotationIdx}
        topLevelTotal={liveTopLevel.length}
        onOpenPicker={() => void openPicker()}
        onPrevAnnotation={gotoPrevAnnotation}
        onNextAnnotation={gotoNextAnnotation}
        onSplit={() => setLayout("split")}
        onUnified={() => setLayout("unified")}
      />

      {liveSnapshotLost && (
        <box height={2} width="100%" paddingX={1}>
          <text fg={theme.fg.attention} bold>
            ⚠ Snapshot lost — annotations preserved but diff cannot be displayed
          </text>
        </box>
      )}

      {/* Main layout */}
      <box flexGrow={1} width="100%" flexDirection="row">
        {/* Sidebar */}
        <box
          width={30}
          borderStyle="single"
          borderColor={sidebarFocused ? theme.border.accent : theme.border.default}
          title=" Files "
          flexDirection="column"
          onMouseDown={() => setSidebarFocused(true)}
        >
          <scrollbox ref={sidebarScrollRef} height="100%">
            {visibleRows.map((row, idx) => {
              const isSelected = idx === safeRowIdx;
              const bg = isSelected ? theme.bg.accentCursor.tui : undefined;
              const onRowMouseDown = () => {
                setSidebarFocused(true);
                setSelectedRowIdx(idx);
                if (row.kind === "file") {
                  if (diffScrollRef.current) {
                    diffScrollRef.current.scrollChildIntoView(`file-card-${row.path}`);
                  }
                  // Same semantics as the select-file action above (PRD
                  // US 20): clicking a file in the sidebar expresses "show
                  // me from the top." A folded click yields null since
                  // the file contributes no flat rows.
                  setCursor(cursorAtFirstFileRow(row.path, flatRowsList));
                }
              };
              if (row.kind === "folder") {
                return (
                  <text
                    key={`d:${row.path}`}
                    id={`row-${row.path}`}
                    fg={theme.fg.muted}
                    bg={bg}
                    bold={isSelected}
                    selectable={false}
                    onMouseDown={onRowMouseDown}
                  >
                    {folderRowLabel(row)}
                  </text>
                );
              }
              return (
                <text
                  key={`f:${row.path}`}
                  id={`row-${row.path}`}
                  fg={theme.fg.default}
                  bg={bg}
                  bold={isSelected}
                  selectable={false}
                  onMouseDown={onRowMouseDown}
                >
                  {fileRowLabel(row)}
                </text>
              );
            })}
          </scrollbox>
        </box>

        {/* Diff pane */}
        <box
          flexGrow={1}
          borderStyle="single"
          borderColor={!sidebarFocused ? theme.border.accent : theme.border.default}
          title=" Diff "
          flexDirection="column"
          onMouseDown={() => setSidebarFocused(false)}
        >
          {!liveSnapshotLost && liveDiff && (
            <scrollbox
              ref={diffScrollRef}
              height="100%"
              focused={!sidebarFocused && composer === null}
              viewportCulling={false}
            >
              {files.map((file) => {
                const collapsed = isFileCollapsed(file.name);
                const rows = plannedRowsByFile.get(file.name) ?? [];
                return (
                  <box
                    key={file.name}
                    id={`file-card-${file.name}`}
                    borderStyle="single"
                    borderColor={theme.border.default}
                    flexDirection="column"
                    marginBottom={1}
                  >
                    <text>{fileEntryLabel(file, liveClassifications, liveAnnotations)}</text>
                    {fileCardBody(
                      file.name,
                      collapsed,
                      file.hunks.length > 0,
                      rows,
                      layout,
                      currentAnnotationId,
                      cursor,
                      onCursorClick,
                      repliesCollapsed,
                      liveReplyLock,
                      now,
                    )}
                  </box>
                );
              })}
            </scrollbox>
          )}
        </box>
      </box>

      {/* Footer */}
      <box height={1} width="100%" paddingX={1}>
        <text fg={theme.fg.muted}>{footer}</text>
      </box>

      {pickerOpen && (
        <TourPicker
          rows={pickerRows}
          currentTourId={liveTour.id}
          cursor={pickerCursor}
        />
      )}

      {composer && <Composer state={composer} onSubmit={(body) => void submitComposer(body)} />}
    </box>
  );
}

export async function startTui(props: AppProps): Promise<void> {
  const renderer = await createCliRenderer({
    screenMode: "alternate-screen",
    useMouse: true,
    // React state owns which pane is focused; the renderer's auto-focus on
    // mouse-down would otherwise focus the underlying scrollbox out-of-band
    // and route j/k to its built-in viewport scroll, conflicting with our
    // keymap row navigation.
    autoFocus: false,
    exitOnCtrlC: true,
  });
  const root = createRoot(renderer);
  root.render(<App {...props} />);
  await new Promise<void>((resolve) => {
    renderer.once("destroy", () => resolve());
  });
}
