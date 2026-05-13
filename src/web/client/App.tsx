import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Annotation, BundleFile, TourBundle, TourSummary } from "./types.js";
import { fileIcon } from "./file-icon.js";
import { ChevronDownIcon, ChevronRightIcon, FileDirectoryFillIcon } from "./icons.js";
import { AnnotationMarkdown } from "./markdown/AnnotationMarkdown.js";
import { TourPicker } from "./TourPicker.js";
import { buildPickerRows, pickAutoTour } from "../../core/tour-list.js";
import {
  TourSessionStore,
  useTourSession,
  isPickerOpen,
  isBundleResolved,
  resolvedReplyLock,
  pickerHighlighted,
  initialTourSessionState,
  type ComposerTarget,
  type Layout,
  type TourSummary as SessionTourSummary,
} from "../../core/tour-session.js";
import {
  buildThreads,
  isTopLevel,
  latestAnnotationId,
  latestHumanLeafId,
  topLevelAnnotations,
} from "../../core/threads.js";
import { ageMs, isStale, type ReplyLock } from "../../core/reply-lock.js";
import {
  canSendToAgent,
  type CanSendToAgentResult,
} from "../../core/can-send-to-agent.js";
import {
  buildTree,
  compress,
  flatten,
  revealAncestors,
  sortFilesForStream,
  type VisibleRow,
} from "../../core/file-tree.js";
import { flatRows as buildFlatRows } from "../../core/flat-rows.js";
import { planRows, GAP_TWO_ROW_THRESHOLD, type PlannedRow } from "../../core/diff-rows.js";
import { parseFileDiffMetadata, type FileDiffMetadata } from "../../core/diff-model.js";
import {
  emptyExpansion,
  getBoundary,
  type OrphanWindow,
} from "../../core/expansion-state.js";
import {
  cursorFromAnnotation,
  initialCursor,
  moveCursor,
  nextCard,
  prevCard,
  preferredSideOf,
  setCursorSide,
  validateCursor,
  type Cursor,
} from "../../core/cursor-state.js";
import { dispatchCursorKey } from "./cursor-keymap.js";
import { FileBlock, type ExpandAction } from "./FileBlock.js";
import { tourDiffStats } from "./diff-stats.js";
import { EXPANSION_STEP } from "./row-components.js";
import { FILE_GRID_CSS } from "./file-grid-css.js";
import { decideReanchor } from "./re-anchor-policy.js";
import { readTourFromLocation, readAnnFromLocation, composeUrl } from "./url-routing.js";
import { recallCardIntoView } from "./auto-recall.js";

// Escape a string for safe interpolation into a CSS attribute selector
// (`[data-file="${cssEscapeFile(path)}"]`). Uses the platform's
// `CSS.escape` when available; falls back to a minimal escaper for the
// characters file paths can carry.
function cssEscapeFile(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, (c) => `\\${c}`);
}

interface PostBody {
  body: string;
  file?: string;
  side?: "additions" | "deletions";
  line_start?: number;
  line_end?: number;
  replies_to?: string;
}

interface AppProps {
  initialTourId: string | null;
  // The renderer-configured reply-agent name (from `--reply-agent <name>`,
  // baked into the SPA via `__INITIAL_REPLY_AGENT__`). Null when the
  // server was launched without `--reply-agent`; the "Send to {agent}"
  // affordance stays hidden in that case.
  replyAgent?: string | null;
}

function defaultCollapsedFor(file: BundleFile, annotations: Annotation[]): boolean {
  const reason = file.classification.reason;
  if (reason === "binary") return true;
  if (
    file.classification.collapsed === true &&
    !annotations.some((a) => a.file === file.name && isTopLevel(a))
  ) {
    return true;
  }
  return false;
}

function readTourFromUrl(fallback: string | null): string | null {
  if (typeof window === "undefined") return fallback;
  return readTourFromLocation(window.location, fallback);
}

function readAnnFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return readAnnFromLocation(window.location);
}

export function App({ initialTourId, replyAgent }: AppProps): React.JSX.Element {
  // Tour-session store (PRD #207 slice 1, issue #210; bundle hoisted into
  // the store in issue #211). One store per SPA mount, seeded with the
  // URL-resolved tour id so the initial render sees the right
  // currentTourId. The store's `bundle` slice is the rendering source of
  // truth: `tour.switched` lands on picker.commit / popstate / auto-pick
  // resolves (applies the CONTEXT-pinned reset cascade);
  // `bundle.refreshed` lands on SSE annotation-changed (same-tour
  // refresh; no resets).
  const storeRef = useRef<TourSessionStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = new TourSessionStore({
      ...initialTourSessionState(),
      currentTourId: readTourFromUrl(initialTourId),
    });
  }
  const store = storeRef.current;
  const sessionState = useTourSession(store);
  const tourId = sessionState.currentTourId;
  const tourList: TourSummary[] | null =
    sessionState.tourList.kind === "ok"
      ? (sessionState.tourList.value as TourSummary[])
      : null;
  const pickerOpen = isPickerOpen(sessionState);
  const bundle = isBundleResolved(sessionState);
  const bundleError =
    sessionState.bundle.kind === "err" ? sessionState.bundle.error : null;
  const bundleLoaded =
    sessionState.bundle.kind === "ok" || sessionState.bundle.kind === "err";

  // Reply-lock lives in the Tour-session store's `replyLock` slice (issue
  // #213, follow-up to #211): the SSE handler + mount-time refetcher
  // dispatch `replyLock.loaded`; rendering reads via the selector. Mirrors
  // the TUI's #211 wiring; the local `useState<ReplyLock | null>` that
  // shadowed the slice on the webapp is gone.
  const replyLock = resolvedReplyLock(sessionState);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  // Folds (collapsedFolders + collapsedOverrides), layout, and composer
  // (target / body / error as one tagged-union slice) all live in the Tour-
  // session store (PRD #234 slice 3, issue #238). The webapp's three local
  // composer useStates (composerTarget + composerError + textarea body) and
  // the folds / layout useStates are gone; reads route through the store
  // slices; the reducer's `tour.switched` cascade owns all resets.
  const collapsedFolders = sessionState.collapsedFolders;
  const collapsedOverrides = sessionState.collapsedOverrides;
  const layout = sessionState.layout;
  const composer = sessionState.composer;
  const composerTarget: ComposerTarget | null =
    composer.kind === "closed" ? null : composer.target;
  const composerError: string | null =
    composer.kind === "errored" ? composer.error : null;
  const composerBody: string = composer.kind === "closed" ? "" : composer.body;
  // Unified cursor (ADR 0022 / PRD #192) lives in the Tour-session store
  // (PRD #229 slice 2, issue #232): the local `useState<Cursor | null>`
  // that previously shadowed the slice is gone. The reducer's cursor.*
  // branches own the lazy-materialization rule, the tour-switch reset,
  // and the cross-async revalidation pipeline; the surface translates
  // input events into cursor.* actions and realizes the emitted
  // visual-side-effect intents (scrollCursorTarget, revealSidebarFile,
  // mirrorAnnUrl) into DOM / history substrate.
  const cursor = sessionState.cursor;
  // Hidden-context expansion (PRD #212 / ADR 0024) lives in the Tour-
  // session store too (PRD #229 slice 2, issue #232). The store's
  // tour.switched branch resets to empty; mount-time / SSE-refresh
  // orphan-window seeding dispatches `expansion.seedFromOrphans`.
  const expansion = sessionState.expansion;
  const annotationRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pickerButtonRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const sidebarRowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  // Refs holding the latest React-state inputs the intent handlers need.
  // The intent listener fires synchronously inside `store.dispatch`, BEFORE
  // React re-renders, so the listener's closure captures stale values. The
  // refs are written on every render so the listener reads "the values as
  // of the most recent commit," which is what we want — only the store
  // slice changed in this dispatch.
  const intentInputsRef = useRef<{
    setSelectedFile: (next: string | null) => void;
    revealFileAncestors: (file: string) => void;
    findFileBlock: (name: string) => HTMLElement | null;
  } | null>(null);

  // Fetches /api/tours/<id> and dispatches `tour.switched` (or
  // `bundle.failed`) into the store (issue #211: the store's bundle slice
  // is now authoritative). Stale-response guard: drops the response if a
  // later tour-switch has moved the store's currentTourId off `tourId`.
  // Caller is responsible for ensuring bundle.loading was dispatched (the
  // reducer's picker.commit does this; popstate / auto-pick / initial mount
  // do it explicitly below).
  const loadBundle = useCallback(
    (id: string) => {
      void (async () => {
        try {
          const res = await fetch(`/api/tours/${id}`);
          const data = (await res.json()) as TourBundle | { error: string };
          if (store.getState().currentTourId !== id) return;
          if ("error" in data) {
            store.dispatch({ type: "bundle.failed", tourId: id, error: data.error });
          } else {
            store.dispatch({ type: "tour.switched", tourId: id, bundle: data });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (store.getState().currentTourId !== id) return;
          store.dispatch({ type: "bundle.failed", tourId: id, error: message });
        }
      })();
    },
    [store],
  );

  // Intent listener — realizes the store's intent emissions in DOM /
  // network / history substrate (PRD #207 / issue #210; slice 2 / issue
  // #232 grows the cursor + expansion intent set).
  useEffect(() => {
    return store.onIntent((intent) => {
      switch (intent.type) {
        case "loadTour":
          loadBundle(intent.tourId);
          break;
        case "scrollPickerRow": {
          if (typeof document === "undefined") break;
          const el = document.querySelector(
            `[data-picker-row-idx="${intent.idx}"]`,
          );
          el?.scrollIntoView({ block: "nearest" });
          break;
        }
        case "mirrorUrl":
          if (typeof window !== "undefined" && window.history) {
            window.history.pushState(
              { tourId: intent.tourId },
              "",
              composeUrl(intent.tourId, null),
            );
          }
          break;
        case "revalidateCursor": {
          // Bundle just landed (watcher SSE refresh). Recompute flat-rows
          // from the fresh bundle + current layout / folds / expansion;
          // call `validateCursor` to decide preserve / snap / clear. The
          // recompute is inline because React hasn't re-rendered yet —
          // useMemo's flatRowsList still reflects the old bundle.
          const state = store.getState();
          const cursor = state.cursor;
          if (cursor === null) break;
          const bundle =
            state.bundle.kind === "ok" ? state.bundle.value : null;
          if (!bundle || bundle.kind !== "ok") break;
          const inputs = intentInputsRef.current;
          if (!inputs) break;
          const bundleAnnotations = bundle.annotations;
          const parsedFilesFresh = sortFilesForStream(
            parseFileDiffMetadata(bundle.diff),
          );
          const modelFilesFresh = new Map<string, BundleFile>();
          for (const f of bundle.files) modelFilesFresh.set(f.name, f);
          const overrides = state.collapsedOverrides;
          const isClassifierCollapsedFresh = (name: string): boolean => {
            const override = overrides[name];
            if (override === false) return false;
            const f = modelFilesFresh.get(name);
            if (!f) return false;
            if (!f.classification.collapsed) return false;
            if (f.classification.reason === "binary") return false;
            return true;
          };
          const isCollapsedFresh = (name: string): boolean => {
            if (name in overrides) return overrides[name];
            const f = modelFilesFresh.get(name);
            return f ? defaultCollapsedFor(f, bundleAnnotations) : false;
          };
          const plannedFresh = new Map<string, PlannedRow[]>();
          for (const f of parsedFilesFresh) {
            const bf = modelFilesFresh.get(f.name);
            plannedFresh.set(
              f.name,
              planRows(f, bundleAnnotations, state.layout, {
                oldContent: bf?.oldContent,
                newContent: bf?.newContent,
                expansion: state.expansion,
                classifierCollapsed: isClassifierCollapsedFresh(f.name),
              }),
            );
          }
          const flatFresh = buildFlatRows(
            parsedFilesFresh.map((f) => ({
              name: f.name,
              type: "change",
              hunks: [],
            })),
            plannedFresh,
            isCollapsedFresh,
          );
          const validated = validateCursor(cursor, flatFresh, parsedFilesFresh);
          if (validated === cursor) break;
          if (validated === null) {
            store.dispatch({ type: "cursor.clear" });
          } else {
            store.dispatch({ type: "cursor.set", anchor: validated });
          }
          break;
        }
        case "scrollCursorTarget": {
          // Defer to RAF so cursor.set landing under a fresh bundle waits
          // for React's commit before querying DOM — matches the existing
          // scrollAnnotationIntoView pattern.
          if (typeof document === "undefined") break;
          const target = intent.target;
          requestAnimationFrame(() => {
            if (target.kind === "card") {
              annotationRefs.current
                .get(target.annotationId)
                ?.scrollIntoView({ behavior: "instant", block: "center" });
              return;
            }
            const inputs = intentInputsRef.current;
            if (!inputs) return;
            const block = inputs.findFileBlock(target.file);
            if (!block) return;
            const cell = block.querySelector<HTMLElement>(
              `.tour-row-gutter[data-side="${target.side}"][data-line-number="${target.lineNumber}"]`,
            );
            cell?.scrollIntoView({ block: "nearest" });
          });
          break;
        }
        case "revealSidebarFile": {
          const inputs = intentInputsRef.current;
          if (!inputs) break;
          inputs.setSelectedFile(intent.file);
          store.dispatch({
            type: "folds.setOverride",
            file: intent.file,
            value: false,
          });
          inputs.revealFileAncestors(intent.file);
          break;
        }
        case "mirrorAnnUrl": {
          // `replaceState` (not `pushState`) so back/forward steps over Tour
          // switches, not over every cursor move. The URL composer uses the
          // store's current tourId so an in-flight tour-switch can't write
          // the wrong tour's URL.
          if (typeof window === "undefined" || !window.history) break;
          const tid = store.getState().currentTourId;
          if (tid === null) break;
          const url = composeUrl(tid, intent.annotationId);
          const current =
            window.location.pathname + window.location.search + window.location.hash;
          if (url === current) break;
          window.history.replaceState(window.history.state, "", url);
          break;
        }
        case "submitAnnotation": {
          // PRD #234 slice 3, issue #238. Composer submit / retry routes
          // through the store: reducer transitions to `submitting` and
          // emits this intent; surface POSTs to the existing
          // `/api/tours/:id/annotations` endpoint with the same payload
          // shape as before, then dispatches `composer.submitted`
          // (success) or `composer.failed` (failure) to close the loop.
          const { tourId: submitTourId, target, body } = intent;
          const trimmed = body.trim();
          const payload: PostBody =
            target.kind === "reply"
              ? { body: trimmed, replies_to: target.replies_to }
              : {
                  body: trimmed,
                  file: target.file,
                  side: target.side,
                  line_start: target.line_start,
                  line_end: target.line_end,
                };
          void (async () => {
            try {
              const res = await fetch(
                `/api/tours/${submitTourId}/annotations`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(payload),
                },
              );
              if (!res.ok) {
                const data = (await res.json().catch(() => ({}))) as {
                  error?: string;
                };
                store.dispatch({
                  type: "composer.failed",
                  error: data.error ?? `HTTP ${res.status}`,
                });
                return;
              }
              const ann = (await res.json()) as Annotation;
              store.dispatch({ type: "composer.submitted", annotation: ann });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              store.dispatch({ type: "composer.failed", error: message });
            }
          })();
          break;
        }
        case "scrollToAnnotation": {
          // The freshly-created card may not yet be in the DOM — SSE
          // delivers the new bundle asynchronously. Defer to RAF; if the
          // ref still isn't present, the scroll is silently a no-op (the
          // SSE refresh will land the card in view anyway, since reply
          // / inline annotations render adjacent to the cursor's existing
          // anchor).
          if (typeof document === "undefined") break;
          const id = intent.annotationId;
          requestAnimationFrame(() => {
            annotationRefs.current
              .get(id)
              ?.scrollIntoView({ behavior: "instant", block: "center" });
          });
          break;
        }
      }
    });
  }, [store, loadBundle]);

  // Mount-time: fetch tour list via store dispatches, auto-pick on bare URL,
  // and kick off the initial bundle load if a tour-id was already seeded
  // from the URL.
  useEffect(() => {
    store.dispatch({ type: "tourList.loading" });
    void (async () => {
      try {
        const res = await fetch("/api/tours?status=all");
        const tours = (await res.json()) as SessionTourSummary[];
        store.dispatch({ type: "tourList.loaded", tours });
        // Auto-pick at bare `/`: most-recent open (issue #187 — shared
        // with the server's bare-`tour serve` pre-pick). Closed-only
        // repos fall through to the most-recent overall.
        if (store.getState().currentTourId === null && tours.length > 0) {
          const auto = pickAutoTour(tours);
          const autoId = auto?.id ?? tours[tours.length - 1].id;
          store.dispatch({ type: "bundle.loading", tourId: autoId });
          loadBundle(autoId);
        }
      } catch (err) {
        store.dispatch({
          type: "tourList.failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    // URL-seeded initial bundle load. picker.commit / popstate / auto-pick
    // all dispatch bundle.loading themselves; this branch handles the
    // single case where currentTourId was non-null at mount.
    const initial = store.getState().currentTourId;
    if (initial !== null) {
      store.dispatch({ type: "bundle.loading", tourId: initial });
      loadBundle(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onPop = () => {
      const fromUrl = readTourFromUrl(null);
      const current = store.getState().currentTourId;
      if (fromUrl !== null && fromUrl !== current) {
        // popstate is the equivalent of a picker-commit (issue #210): the
        // session action sets bundle = loading + currentTourId, and the
        // App-side fetcher dispatches tour.switched / bundle.failed. No
        // mirrorUrl — popstate is following the URL, not writing it.
        store.dispatch({ type: "bundle.loading", tourId: fromUrl });
        loadBundle(fromUrl);
      }
      // Mirror `?ann=` / `#<ann-id>` back into the cursor on browser
      // back / forward (PRD #192 / ADR 0022 slice 2). The mount-time
      // restorer is the authoritative seed when the user changes Tour;
      // popstate within the same Tour needs an explicit cursor write
      // since cursorCardId won't change otherwise.
      const annFromUrl = readAnnFromUrl();
      if (annFromUrl !== null) {
        const prev = store.getState().cursor;
        store.dispatch({
          type: "cursor.set",
          anchor: {
            kind: "card",
            annotationId: annFromUrl,
            preferredSide: preferredSideOf(prev),
          },
        });
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [store, loadBundle]);

  // Tour-switch reset for sidebar selection. After PRD #234 slice 3
  // (issue #238) the reducer's `tour.switched` branch owns every reset
  // rule CONTEXT.md pins (picker, replyLock, cursor, expansion,
  // composer, folds; layout preserved). `selectedFile` is the last
  // surface-side `useState` (sidebar position, derivable from cursor,
  // explicitly out of scope per PRD #234 / issue #238).
  useEffect(() => {
    if (!tourId) return;
    setSelectedFile(null);
  }, [tourId]);

  useEffect(() => {
    if (!tourId) return;
    let cancelled = false;
    const refetchLock = async () => {
      try {
        const res = await fetch(`/api/tours/${tourId}/reply-lock`);
        const data = (await res.json()) as ReplyLock | { error: string } | null;
        if (cancelled) return;
        if (data && typeof data === "object" && "error" in data) {
          store.dispatch({ type: "replyLock.loaded", replyLock: null });
        } else {
          store.dispatch({
            type: "replyLock.loaded",
            replyLock: data as ReplyLock | null,
          });
        }
      } catch {
        // transient — keep current pill state
      }
    };
    void refetchLock();

    const evtSource = new EventSource(`/api/tours/${tourId}/events`);
    evtSource.onmessage = async (event) => {
      const msg = JSON.parse(event.data) as { type: string };
      if (msg.type === "annotation-changed") {
        const res = await fetch(`/api/tours/${tourId}`);
        const data = (await res.json()) as TourBundle | { error: string };
        if (cancelled) return;
        if ("error" in data) return;
        // Same-tour refresh (issue #211): dispatch `bundle.refreshed`
        // (NOT `tour.switched`) so the SSE refresh doesn't trigger the
        // CONTEXT-pinned Tour-switch reset cascade (picker close +
        // replyLock idle).
        store.dispatch({ type: "bundle.refreshed", bundle: data });
      } else if (msg.type === "reply-in-flight" || msg.type === "reply-cleared") {
        await refetchLock();
      }
    };
    return () => {
      cancelled = true;
      evtSource.close();
    };
  }, [tourId]);

  const tourMeta = bundle?.tour ?? null;
  const annotations = useMemo(() => bundle?.annotations ?? [], [bundle?.annotations]);
  const topLevel = useMemo(() => topLevelAnnotations(annotations), [annotations]);
  // 1-based nav-order index per top-level annotation id, for rendering the
  // `i / n` counter in each AnnotationCard header. Stable Map so FileBlock's
  // memo bails on cursor moves.
  const navIndexById = useMemo(() => {
    const m = new Map<string, number>();
    topLevel.forEach((a, i) => m.set(a.id, i + 1));
    return m;
  }, [topLevel]);
  const navTotal = topLevel.length;
  const repliesByRoot = useMemo(() => {
    const out = new Map<string, Annotation[]>();
    for (const t of buildThreads(annotations)) {
      out.set(t.root.id, t.replies);
    }
    return out;
  }, [annotations]);
  // The cursor's card target (PRD #192 / ADR 0022) when the cursor is on
  // an Annotation card; null on row / null cursor. Drives the active-card
  // visual treatment and the SequencePill counter. (URL mirroring lives
  // in the store's `mirrorAnnUrl` intent — see the intent listener.)
  const cursorCardId: string | null =
    cursor?.kind === "card" ? cursor.annotationId : null;
  const currentIdx = useMemo(() => {
    if (cursorCardId === null) return -1;
    return topLevel.findIndex((a) => a.id === cursorCardId);
  }, [topLevel, cursorCardId]);
  // Which file holds the cursor's card, so the active-card prop only goes
  // to that one FileBlock. Before this, every FileBlock saw the prop
  // change on every n/p and bailed React.memo, re-rendering all ~650 files
  // for a single annotation step. Now only the old + new annotation's
  // files re-render on nav.
  const cursorCardFile = useMemo<string | null>(() => {
    if (cursorCardId === null) return null;
    return annotations.find((a) => a.id === cursorCardId)?.file ?? null;
  }, [annotations, cursorCardId]);

  const liveDiff = bundle && bundle.kind === "ok" ? bundle.diff : "";
  const liveFiles = useMemo<BundleFile[]>(
    () => (bundle && bundle.kind === "ok" ? bundle.files : []),
    [bundle],
  );
  // O(1) lookup keyed by file name. The previous render-time
  // `liveFiles.find(...)` per `<FileBlock>` is O(N) per file × N files
  // per render = O(N²) and — more importantly — returns the same
  // BundleFile reference each time, but inside a fresh arrow per
  // render. Hoisting to a stable Map keeps the modelFile prop
  // referentially stable across renders so React.memo can short-circuit.
  const modelFilesByName = useMemo<Map<string, BundleFile>>(() => {
    const m = new Map<string, BundleFile>();
    for (const f of liveFiles) m.set(f.name, f);
    return m;
  }, [liveFiles]);
  const snapshotLost = bundle?.kind === "snapshot-lost";

  const parsedFiles = useMemo<FileDiffMetadata[]>(() => {
    if (!tourMeta || !liveDiff) return [];
    const raw = parseFileDiffMetadata(liveDiff);
    return sortFilesForStream(raw);
  }, [liveDiff, tourMeta?.id]);

  // Seed orphan windows on bundle load (and re-union on SSE refresh; new
  // annotations may add windows). seedFromOrphans is a union — per-side
  // expansion is `Math.max(prev, w.fromStart/fromEnd)` so manually-
  // expanded user state is preserved across reloads (mirrors TUI #114).
  useEffect(() => {
    if (!liveFiles.length) return;
    const windows: OrphanWindow[] = [];
    for (const f of liveFiles) {
      for (const w of f.orphanWindows) {
        windows.push({ file: f.name, ref: w.ref, fromStart: w.fromStart, fromEnd: w.fromEnd });
      }
    }
    if (windows.length === 0) return;
    store.dispatch({ type: "expansion.seedFromOrphans", windows });
  }, [liveFiles, store]);

  const tree = useMemo(() => compress(buildTree(liveFiles)), [liveFiles]);
  const annotationCounts = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const a of topLevel) {
      out[a.file] = (out[a.file] ?? 0) + 1;
    }
    return out;
  }, [topLevel]);
  const visibleRows = useMemo<VisibleRow<BundleFile>[]>(
    () => flatten(tree, collapsedFolders, annotationCounts),
    [tree, collapsedFolders, annotationCounts],
  );

  const revealFileAncestors = useCallback(
    (filePath: string) => {
      const ancestors = revealAncestors(tree, filePath);
      if (ancestors.length === 0) return;
      // Dispatch `folds.toggleFolder` for ancestors that ARE in the set.
      // The reducer's toggleFolder branch is presence-aware (delete on
      // present, add on absent); only-collapsed ancestors are toggled
      // off so already-open folders stay open. Reads the live store
      // snapshot at call time — safe to do per-iteration because the
      // ancestor list is stable and the snapshot is captured up-front.
      const current = store.getState().collapsedFolders;
      for (const a of ancestors) {
        if (current.has(a)) {
          store.dispatch({ type: "folds.toggleFolder", path: a });
        }
      }
    },
    [tree, store],
  );

  const toggleFolder = useCallback(
    (folderPath: string) => {
      store.dispatch({ type: "folds.toggleFolder", path: folderPath });
    },
    [store],
  );

  // Initial-anchor scroll (URL `?ann=` restore / default first annotation).
  // Post-cutover the row renderer paints synchronously so a single
  // scrollIntoView lands the target without R1/R2 race mitigation. The
  // intent is `behavior: "instant"` because the user is landing on a
  // bookmark — a smooth animation would visibly jitter on first paint.
  const anchorInitial = useCallback((id: string) => {
    annotationRefs.current
      .get(id)
      ?.scrollIntoView({ behavior: "instant", block: "center" });
  }, []);

  const navigateBy = useCallback(
    (delta: -1 | 1) => {
      // n/p is the jump gesture: walks top-level order (issue #197 — same
      // as the SequencePill counter), independent of cursor position
      // (issue #206 revert of #203). From a RowAnchor or null cursor, the
      // walk enters the track at the topLevel edge (first for `n`, last
      // for `p`). The cursor.set dispatch fires scrollCursorTarget +
      // mirrorAnnUrl intents which the listener realizes; the
      // revealSidebarFile intent doesn't fire on Card→Card (the cursor's
      // resolved file is null on either end), so we still call
      // revealFileAncestors / setSelectedFile / collapsedOverrides
      // inline here.
      const target = delta === 1 ? nextCard(cursor, topLevel) : prevCard(cursor, topLevel);
      if (!target) return;
      const ann = topLevel.find((a) => a.id === target.annotationId);
      if (!ann) return;
      setSelectedFile(ann.file);
      store.dispatch({
        type: "folds.setOverride",
        file: ann.file,
        value: false,
      });
      revealFileAncestors(ann.file);
      store.dispatch({ type: "cursor.set", anchor: target });
    },
    [cursor, topLevel, revealFileAncestors, store],
  );

  // Re-anchor cursor to a top-level Annotation card on bundle load (PRD #192
  // / ADR 0022; issue #197 Bug B). When the URL carries `?ann=<id>` (or its
  // `#<ann-id>` fragment shape from Issue #179), resolve it to a top-level
  // Annotation; a stale id (deleted, hand-edited, or pointing at a Reply)
  // falls back to the first top-level Annotation. Gated on the loaded
  // Tour matching the routing Tour id so the in-flight Tour-switch window
  // doesn't anchor the new URL's `ann=` against the previous Tour's
  // annotations. The policy discriminator is `cursor === null` (not
  // `cursorCardId === null`) — a RowAnchor cursor from a `j`/`k` press
  // is a noop, so row motion survives the same render. The cursor.set
  // dispatch fires the mirrorAnnUrl intent which keeps `?ann=` in sync;
  // url-restore anchors only fire the URL write as a no-op since the URL
  // already matches.
  useEffect(() => {
    if (!tourMeta || tourMeta.id !== tourId) return;
    if (topLevel.length === 0) {
      setSelectedFile((curr) => (curr === null ? curr : null));
      return;
    }
    const action = decideReanchor(cursor, readAnnFromUrl(), topLevel);
    if (action.kind === "noop") return;
    store.dispatch({
      type: "cursor.set",
      anchor: cursorFromAnnotation(action.target, preferredSideOf(cursor)),
    });
    setSelectedFile(action.target.file);
    revealFileAncestors(action.target.file);
    if (action.kind === "url-restore") anchorInitial(action.target.id);
  }, [tourMeta, tourId, topLevel, cursor, revealFileAncestors, anchorInitial, store]);

  // Keep the selected sidebar row visible. block:"nearest" — already-visible
  // rows don't jump.
  useEffect(() => {
    if (selectedFile === null) return;
    const el = sidebarRowRefs.current.get(selectedFile);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedFile]);

  const restoreFocusAfterPicker = useCallback(() => {
    const back = triggerRef.current ?? pickerButtonRef.current;
    requestAnimationFrame(() => back?.focus());
  }, []);

  const openPicker = useCallback(() => {
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;
    const tourListData = store.getState().tourList;
    if (tourListData.kind !== "ok") return;
    const counts: Record<string, number> = {};
    if (bundle) counts[bundle.tour.id] = bundle.annotations.length;
    const rows = buildPickerRows({
      tours: tourListData.value,
      annotationCounts: counts,
      now: Date.now(),
    });
    store.dispatch({ type: "picker.open", rows });
  }, [store, bundle]);

  const closePicker = useCallback(() => {
    store.dispatch({ type: "picker.close" });
    restoreFocusAfterPicker();
  }, [store, restoreFocusAfterPicker]);

  const onPickerMove = useCallback(
    (delta: number) => {
      store.dispatch({ type: "picker.move", delta });
    },
    [store],
  );

  const onPickerCommit = useCallback(() => {
    // Short-circuit when the highlighted row is the current tour: don't
    // re-fetch the bundle, just close the picker. Preserves the pre-refactor
    // "Enter on current row" behavior (commitTour's `if (id !== tourId)`).
    const s = store.getState();
    const target = pickerHighlighted(s);
    if (!target) return;
    if (target.id === s.currentTourId) {
      store.dispatch({ type: "picker.close" });
    } else {
      store.dispatch({ type: "picker.commit" });
    }
    restoreFocusAfterPicker();
  }, [store, restoreFocusAfterPicker]);

  const registerAnnotationRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) {
      annotationRefs.current.set(id, el);
    } else {
      annotationRefs.current.delete(id);
    }
  }, []);

  const isCollapsed = useCallback(
    (fileName: string): boolean => {
      if (fileName in collapsedOverrides) return collapsedOverrides[fileName];
      const f = liveFiles.find((x) => x.name === fileName);
      return f ? defaultCollapsedFor(f, annotations) : false;
    },
    [collapsedOverrides, liveFiles, annotations],
  );

  const toggleCollapsed = useCallback(
    (fileName: string) => {
      store.dispatch({
        type: "folds.setOverride",
        file: fileName,
        value: !isCollapsed(fileName),
      });
    },
    [isCollapsed, store],
  );

  // Look up a file's outer wrapper by `data-file` attribute. Used for
  // scroll-into-view on sidebar selection. The wrapper is owned by
  // `<FileBlock>` (`tour-file-outer`); querying lazily avoids a ref-map
  // round-trip that React.memo would have to thread through the prop list.
  const findFileBlock = useCallback((name: string): HTMLElement | null => {
    if (typeof document === "undefined") return null;
    return document.querySelector<HTMLElement>(`[data-file="${cssEscapeFile(name)}"]`);
  }, []);

  // Keep the intent-handler input ref fresh. The listener fires
  // synchronously inside store.dispatch, BEFORE React re-renders, so its
  // closure can't see post-dispatch state — but it can read the values
  // from the most recent commit via this ref.
  intentInputsRef.current = {
    setSelectedFile,
    revealFileAncestors,
    findFileBlock,
  };

  // Sidebar counterparts so memoized FileRow / FolderRow don't re-render
  // on every App state change. Path flows as an argument, so a single
  // stable function reference serves every sidebar row.
  const registerSidebarRef = useCallback(
    (path: string, el: HTMLButtonElement | null) => {
      if (el) sidebarRowRefs.current.set(path, el);
      else sidebarRowRefs.current.delete(path);
    },
    [],
  );
  const selectFile = useCallback(
    (name: string) => {
      setSelectedFile(name);
      const el = findFileBlock(name);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [findFileBlock],
  );

  // Returns true when the planner should emit a synthetic CollapsedFileRow
  // in place of this file's diff body (PRD #108 issue #113). Mirror of the
  // TUI's isClassifierCollapsed — binary files are body-collapsed entirely,
  // not synthetic-row-collapsed; classifier-collapsed non-binary files
  // emit the synthetic row unless the user has overridden `c`.
  const isClassifierCollapsed = useCallback(
    (fileName: string): boolean => {
      const override = collapsedOverrides[fileName];
      if (override === false) return false;
      const f = liveFiles.find((x) => x.name === fileName);
      if (!f) return false;
      if (!f.classification.collapsed) return false;
      if (f.classification.reason === "binary") return false;
      return true;
    },
    [collapsedOverrides, liveFiles],
  );

  // Cursor walk sequence (ADR 0012). Per-file planned rows are built from
  // each parsed file + the annotation list + the active layout (split vs
  // unified differ in pairing) + the per-tour expansion state. The flat-
  // rows builder skips folded files and hunk-header / annotation rows,
  // leaving a walkable sequence indexed by moveCursor.
  const plannedRowsByFile = useMemo(() => {
    const out = new Map<string, PlannedRow[]>();
    for (const f of parsedFiles) {
      const bf = modelFilesByName.get(f.name);
      out.set(
        f.name,
        planRows(f, annotations, layout, {
          oldContent: bf?.oldContent,
          newContent: bf?.newContent,
          expansion,
          classifierCollapsed: isClassifierCollapsed(f.name),
        }),
      );
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedFiles, annotations, layout, expansion, modelFilesByName, isClassifierCollapsed]);

  const flatRowsList = useMemo(() => {
    return buildFlatRows(
      parsedFiles.map((f) => ({ name: f.name, type: "change", hunks: [] })),
      plannedRowsByFile,
      isCollapsed,
    );
  }, [parsedFiles, plannedRowsByFile, isCollapsed]);

  // Tour-level (PR-equivalent) `+N -M` totals for the title-bar indicator
  // (issue #233 / PRD #212). Computed once per bundle by planning each
  // file's rows with stable args (split layout, empty expansion, no
  // annotations, no classifier-collapse) so the count reflects the FULL
  // diff regardless of which files are currently collapsed in the UI or
  // classifier-flagged for collapse. Cursor moves, layout toggles,
  // expansion changes, and annotation navigation do NOT re-walk — none of
  // them touch `parsedFiles` / `modelFilesByName`.
  const tourStats = useMemo(() => {
    const files = parsedFiles.map((f) => {
      const bf = modelFilesByName.get(f.name);
      const rows = planRows(f, [], "split", {
        oldContent: bf?.oldContent,
        newContent: bf?.newContent,
        expansion: emptyExpansion(),
        classifierCollapsed: false,
      });
      return { rows };
    });
    return tourDiffStats(files);
  }, [parsedFiles, modelFilesByName]);

  // Validate-in-place when the row sequence shifts under the cursor's
  // feet on local-state changes the reducer can't see (fold toggle,
  // layout switch). Bundle.refreshed is handled separately via the
  // store's `revalidateCursor` intent — see the intent listener below.
  // The reconciled `validateCursor` (issue #232) preserves the anchor
  // when the cursor's file is in `files` but has no rows (collapsed
  // file), so no surface-side discriminator is needed.
  useEffect(() => {
    if (cursor === null) return;
    const validated = validateCursor(cursor, flatRowsList, parsedFiles);
    if (validated === cursor) return;
    if (validated === null) store.dispatch({ type: "cursor.clear" });
    else store.dispatch({ type: "cursor.set", anchor: validated });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatRowsList, parsedFiles]);

  // Lazy materialization (ADR 0012). Dispatches `cursor.materialize` so
  // the reducer's strict no-op on a non-null cursor protects against
  // races; returns the seeded cursor so the caller can chain into
  // composer-open / move actions in one step.
  const materializeCursor = useCallback((): Cursor | null => {
    const c = store.getState().cursor;
    if (c) return c;
    const seeded = initialCursor({ topLevelAnnotations: topLevel, flatRows: flatRowsList });
    if (seeded) store.dispatch({ type: "cursor.materialize", anchor: seeded });
    return seeded;
  }, [store, topLevel, flatRowsList]);

  // Auto-recall (PRD #192 / ADR 0022). When `r` or `s` fires and the cursor's
  // card is not in the viewport, smooth-scroll it to centre BEFORE mounting
  // the composer / dispatching the agent. The pure logic lives in
  // `./auto-recall.ts` so it can be unit-tested without mounting <App />.
  const recallCardThen = useCallback(
    (annotationId: string, then: () => void): void => {
      recallCardIntoView({
        cardElement: annotationRefs.current.get(annotationId) ?? null,
        viewportHeight:
          window.innerHeight || document.documentElement.clientHeight || 0,
        then,
      });
    },
    [],
  );

  // Gap-size lookups for the expansion dispatcher. Mirror of the TUI's
  // hunkSeparatorGapSize / boundaryTopGapSize / boundaryBottomGapSize
  // (src/tui/app.tsx) — sourced from each file's parsed hunks plus the
  // bundle's `newContent` for the trailing gap. The dispatcher needs gap
  // size to drive `expand`'s saturation logic and the symmetric vs
  // unilateral direction choice.
  const parsedFilesByName = useMemo(() => {
    const m = new Map<string, FileDiffMetadata>();
    for (const f of parsedFiles) m.set(f.name, f);
    return m;
  }, [parsedFiles]);

  const hunkSeparatorGapSize = useCallback(
    (file: string, hunkIndex: number): number => {
      const meta = parsedFilesByName.get(file);
      if (!meta || hunkIndex <= 0 || hunkIndex >= meta.hunks.length) return 0;
      const prev = meta.hunks[hunkIndex - 1];
      const next = meta.hunks[hunkIndex];
      return Math.max(0, next.additionStart - (prev.additionStart + prev.additionCount));
    },
    [parsedFilesByName],
  );
  const boundaryTopGapSize = useCallback(
    (file: string): number => {
      const meta = parsedFilesByName.get(file);
      if (!meta || meta.hunks.length === 0) return 0;
      return Math.max(0, meta.hunks[0].additionStart - 1);
    },
    [parsedFilesByName],
  );
  const boundaryBottomGapSize = useCallback(
    (file: string): number => {
      const meta = parsedFilesByName.get(file);
      if (!meta || meta.hunks.length === 0) return 0;
      const last = meta.hunks[meta.hunks.length - 1];
      const lastEnd = last.additionStart + last.additionCount - 1;
      const content = modelFilesByName.get(file)?.newContent;
      if (!content) return 0;
      const trimmed = content.endsWith("\n") ? content.slice(0, -1) : content;
      const lineCount = trimmed === "" ? 0 : trimmed.split("\n").length;
      return Math.max(0, lineCount - lastEnd);
    },
    [parsedFilesByName, modelFilesByName],
  );

  // Translates the FileBlock-emitted ExpandAction into the matching
  // `expansion.*` action on the Tour-session store (PRD #229 slice 2,
  // issue #232). PRD #212 / #151: mid-file hunk-header is direction-
  // aware — large gaps (remaining > 2N = 40) expand the bottom (lines
  // appear above the @@); small gaps (≤ 40) expand symmetrically. gap-
  // mid-top expands the top (adjacent to the previous hunk). FileBlock
  // packages this as `{ kind, file, boundaryRef, direction, count }`;
  // the count is the modifier-aware step (shift → full gap, otherwise
  // EXPANSION_STEP=20). Map count → mode here: count ≥ remaining gap
  // → "all"; otherwise "symmetric-20".
  const dispatchExpand = useCallback(
    (action: ExpandAction) => {
      if (action.kind === "expand-file") {
        store.dispatch({ type: "expansion.expandFile", file: action.file });
        return;
      }
      const { file, boundaryRef, direction, count } = action;
      const gapSize =
        boundaryRef === "top"
          ? boundaryTopGapSize(file)
          : boundaryRef === "bottom"
            ? boundaryBottomGapSize(file)
            : hunkSeparatorGapSize(file, boundaryRef);
      if (gapSize === 0) return;
      // direction "both" needs gap-remaining > 2N to fall back to "down"
      // (matches the TUI's mid-file hunk-header rule). FileBlock passes
      // direction="both" for mid-file hunk-headers; refine here using
      // expansion state.
      let effectiveDirection: "up" | "down" | "both" = direction;
      if (direction === "both" && typeof boundaryRef === "number") {
        const cur = getBoundary(expansion, { file, ref: boundaryRef });
        const remaining = gapSize - cur.up - cur.down;
        if (remaining > GAP_TWO_ROW_THRESHOLD) effectiveDirection = "down";
      }
      const mode = count >= gapSize ? "all" : "symmetric-20";
      if (boundaryRef === "top") {
        store.dispatch({ type: "expansion.expandTop", file, mode, gapSize });
      } else if (boundaryRef === "bottom") {
        store.dispatch({ type: "expansion.expandBottom", file, mode, gapSize });
      } else {
        store.dispatch({
          type: "expansion.expand",
          file,
          ref: boundaryRef,
          direction: effectiveDirection,
          mode,
          gapSize,
        });
      }
    },
    [
      hunkSeparatorGapSize,
      boundaryTopGapSize,
      boundaryBottomGapSize,
      expansion,
      store,
    ],
  );

  // Global keydown router (ADR 0012). Cursor motion (j/k/h/l/arrows),
  // side selection, annotate-at-cursor (a), annotation nav (n/p, with
  // β-coupling to the line cursor), layout toggle (Shift-L, rebound
  // from the previous lowercase l), and picker open (t) all flow
  // through the pure dispatchCursorKey classifier so the keymap
  // contract is testable independent of React state plumbing.
  // Effect is registered AFTER `flatRowsList` and `materializeCursor`
  // are declared so the deps array doesn't read a TDZ binding during
  // render (Issue #131). The handler closure refs would be safe on
  // their own — they only execute on a keystroke — but the deps array
  // is constructed every render, so source position matters here.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const focusInEditable = !!(
        t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
      );
      // Enter / Shift+Enter on a gap-row interactive cursor → dispatch the
      // same expansion action as clicking the row's chevron (PRD #212 user-
      // stories 7-8). collapsed-file routes to `expand-file`. Other
      // interactive subkinds compute count via the EXPANSION_STEP /
      // shift-key contract and dispatch through the FileBlock reducer.
      if (
        e.key === "Enter" &&
        !focusInEditable &&
        composerTarget === null &&
        !pickerOpen &&
        cursor?.kind === "row" &&
        cursor.interactive
      ) {
        const subKind = cursor.interactive.subKind;
        const boundaryRef = cursor.interactive.boundaryRef;
        if (subKind === "collapsed-file") {
          e.preventDefault();
          dispatchExpand({ kind: "expand-file", file: cursor.file });
          return;
        }
        const gapSize =
          subKind === "boundary-top"
            ? boundaryTopGapSize(cursor.file)
            : subKind === "boundary-bottom"
              ? boundaryBottomGapSize(cursor.file)
              : typeof boundaryRef === "number"
                ? hunkSeparatorGapSize(cursor.file, boundaryRef)
                : 0;
        if (gapSize > 0) {
          e.preventDefault();
          const direction: "up" | "down" | "both" =
            subKind === "boundary-top" || subKind === "gap-mid-top"
              ? "up"
              : subKind === "boundary-bottom"
                ? "down"
                : "both";
          const count = e.shiftKey ? Math.max(gapSize, EXPANSION_STEP) : EXPANSION_STEP;
          dispatchExpand({
            kind: "expand",
            file: cursor.file,
            boundaryRef,
            direction,
            count,
          });
          return;
        }
      }
      const action = dispatchCursorKey(
        {
          key: e.key,
          shiftKey: e.shiftKey,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
        },
        {
          composerOpen: composerTarget !== null,
          pickerOpen,
          focusInEditable,
          cursorOnCard: cursor?.kind === "card",
        },
      );
      if (action.type === "noop") return;
      e.preventDefault();
      // Lazy materialization rule (ADR 0012): the first j/k/h/l just
      // SHOWS the cursor at the default target, no move past it. `a`
      // materializes AND opens the composer (handled inline below).
      // `cursor.materialize` dispatch fires scrollCursorTarget via the
      // reducer's setCursor helper, so no explicit scroll call here.
      const motion =
        action.type === "move-down" ||
        action.type === "move-up" ||
        action.type === "set-side-additions" ||
        action.type === "set-side-deletions";
      if (motion && !cursor) {
        materializeCursor();
        return;
      }
      switch (action.type) {
        case "open-picker":
          openPicker();
          return;
        case "toggle-layout":
          store.dispatch({
            type: "layout.set",
            layout: store.getState().layout === "split" ? "unified" : "split",
          });
          return;
        case "nav-next-annotation":
          navigateBy(1);
          return;
        case "nav-prev-annotation":
          navigateBy(-1);
          return;
        case "move-down": {
          // Compute next pure via moveCursor against the latest
          // flat-rows; cursor.set dispatch fires scrollCursorTarget
          // which the intent listener realizes as scrollIntoView.
          const next = moveCursor(cursor, "down", flatRowsList);
          if (next === null || next === cursor) return;
          store.dispatch({ type: "cursor.set", anchor: next });
          return;
        }
        case "move-up": {
          const next = moveCursor(cursor, "up", flatRowsList);
          if (next === null || next === cursor) return;
          store.dispatch({ type: "cursor.set", anchor: next });
          return;
        }
        case "set-side-additions": {
          // Horizontal side toggle stays on the same row, so the cell is
          // already on screen — scrollCursorTarget's scrollIntoView call
          // is a no-op on a visible cell. cursor.setSide is the pure-
          // preference path for cards / interactive rows; row anchors
          // route through `setCursorSide` + cursor.set so the lineNumber
          // recomputes for paired rows.
          const next = setCursorSide(cursor, "additions", flatRowsList);
          if (next === null || next === cursor) return;
          store.dispatch({ type: "cursor.set", anchor: next });
          return;
        }
        case "set-side-deletions": {
          const next = setCursorSide(cursor, "deletions", flatRowsList);
          if (next === null || next === cursor) return;
          store.dispatch({ type: "cursor.set", anchor: next });
          return;
        }
        case "annotate-at-cursor": {
          const c = cursor ?? materializeCursor();
          if (!c) return;
          // The keymap routes `a` to a noop when cursorOnCard is true,
          // so this only fires for row cursors (and null → seeded to a
          // row). Defensive guard keeps the type narrow consistent.
          if (c.kind !== "row") return;
          // Interactive rows (gap-row family, collapsed-file) are not
          // annotatable — `a` is a silent no-op (issue #154, PRD #107 US 14).
          if (c.interactive) return;
          store.dispatch({
            type: "composer.open",
            target: {
              kind: "top-level",
              file: c.file,
              side: c.side,
              line_start: c.lineNumber,
              line_end: c.lineNumber,
            },
          });
          return;
        }
        case "open-reply-on-card": {
          // PRD #192 / ADR 0022. `r` on a card opens the Reply composer
          // for the latest Annotation in that thread (matches the in-card
          // Reply button's #191 semantics). When the cursor's card is off-
          // screen the renderer auto-recalls it before the composer mounts
          // (US 14 — the action reveals its target).
          if (cursor?.kind !== "card") return;
          const cardId = cursor.annotationId;
          const cardAnn = topLevel.find((a) => a.id === cardId);
          if (!cardAnn) return;
          const latestId = latestAnnotationId(cardAnn, repliesByRoot.get(cardId) ?? []);
          recallCardThen(cardId, () => {
            store.dispatch({
              type: "composer.open",
              target: { kind: "reply", replies_to: latestId },
            });
          });
          return;
        }
        case "send-on-card": {
          // PRD #192 / ADR 0022. `s` on a card dispatches the latest human
          // leaf in that thread to the configured reply-agent. Hidden /
          // disabled cases (agent-card, already-replied, lock-held, no
          // agent configured) are silently skipped — the verdict gate is
          // the existing per-card `canSendToAgent` predicate.
          if (cursor?.kind !== "card") return;
          if (!tourId || !replyAgent) return;
          const cardId = cursor.annotationId;
          const cardAnn = topLevel.find((a) => a.id === cardId);
          if (!cardAnn) return;
          const descendants = repliesByRoot.get(cardId) ?? [];
          const leafId = latestHumanLeafId(cardAnn, descendants);
          if (!leafId) return;
          const leaf =
            leafId === cardId ? cardAnn : descendants.find((a) => a.id === leafId);
          if (!leaf) return;
          const verdict = canSendToAgent({
            replyAgentConfigured: true,
            lockHeld: replyLock !== null,
            authorKind: leaf.author_kind,
            hasReply: false,
          });
          if (!verdict.enabled) return;
          recallCardThen(cardId, () => {
            void fetch(`/api/tours/${tourId}/request-reply`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ annotation_id: leafId }),
            }).catch(() => {
              // Network transient — watcher events stay the source of truth.
            });
          });
          return;
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [
    navigateBy,
    pickerOpen,
    openPicker,
    cursor,
    composerTarget,
    flatRowsList,
    materializeCursor,
    topLevel,
    repliesByRoot,
    recallCardThen,
    tourId,
    replyAgent,
    replyLock,
    dispatchExpand,
    boundaryTopGapSize,
    boundaryBottomGapSize,
    hunkSeparatorGapSize,
    store,
  ]);

  const closeComposer = useCallback(() => {
    store.dispatch({ type: "composer.close" });
  }, [store]);

  // Row clicks seed the Line cursor only (issue #137 / PRD #136). The
  // composer is reached via the keyboard `a` shortcut.
  const setCursorFromRowClick = useCallback(
    (file: string, side: "additions" | "deletions", line: number) => {
      store.dispatch({
        type: "cursor.set",
        anchor: { kind: "row", file, lineNumber: line, side, preferredSide: side },
      });
    },
    [store],
  );

  // Click anywhere on an Annotation card → lands the cursor on that card
  // (PRD #192 / ADR 0022 slice 2). Mouse-driven path matches keyboard
  // n/p: both write a CardAnchor for the clicked / nav'd top-level
  // annotation.
  const setCursorFromCardClick = useCallback(
    (annotationId: string) => {
      const a = annotations.find((x) => x.id === annotationId);
      if (!a) return;
      store.dispatch({
        type: "cursor.set",
        anchor: cursorFromAnnotation(a, preferredSideOf(store.getState().cursor)),
      });
      setSelectedFile(a.file);
    },
    [annotations, store],
  );

  const openReplyComposer = useCallback(
    (replies_to: string) => {
      store.dispatch({
        type: "composer.open",
        target: { kind: "reply", replies_to },
      });
    },
    [store],
  );

  // Explicit reply-agent dispatch (issue #184, ADR 0021). Fired by the
  // `Send to {agent}` button below each human Annotation card. Hits the
  // `POST /api/tours/:id/request-reply` endpoint which routes through
  // `requestReply` in core. We don't await the result for UX — the
  // watcher's reply-lock SSE event surfaces the in-flight pill within
  // a debounce tick; on completion, the annotation-changed event brings
  // in the landed Reply. Network errors are silent here; the user's
  // visible signal is the pill (or absence of one).
  const sendToAgent = useCallback(
    (annotationId: string) => {
      if (!tourId) return;
      void fetch(`/api/tours/${tourId}/request-reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ annotation_id: annotationId }),
      }).catch(() => {
        // Network transient — watcher events stay the source of truth.
      });
    },
    [tourId],
  );

  // Submit-or-retry dispatcher (PRD #234 slice 3, issue #238). Reads the
  // current composer kind and routes to `composer.submit` (open) or
  // `composer.retry` (errored); both transitions land on `submitting` and
  // emit the `submitAnnotation` intent which the intent listener realises
  // as an HTTP POST. The body-trimming gate stays in the UI so we don't
  // round-trip whitespace-only drafts; the reducer doesn't validate body
  // shape.
  const submitComposer = useCallback(() => {
    const c = store.getState().composer;
    if (c.kind === "open") {
      if (c.body.trim().length === 0) return;
      store.dispatch({ type: "composer.submit" });
    } else if (c.kind === "errored") {
      if (c.body.trim().length === 0) return;
      store.dispatch({ type: "composer.retry" });
    }
  }, [store]);

  const onComposerBodyChange = useCallback(
    (body: string) => {
      store.dispatch({ type: "composer.setBody", body });
    },
    [store],
  );

  const setLayoutChoice = useCallback(
    (next: Layout) => {
      store.dispatch({ type: "layout.set", layout: next });
    },
    [store],
  );

  if (!bundleLoaded && !tourList) {
    return <div className="empty">Loading…</div>;
  }

  if (tourList && tourList.length === 0) {
    return <div className="empty">No tours found. Create one with: tour create --head HEAD</div>;
  }

  if (bundleError) {
    return <div className="empty">Error: {bundleError}</div>;
  }

  if (!bundle || !tourMeta) {
    return <div className="empty">Loading…</div>;
  }

  const titleIsEmpty = !tourMeta.title;

  return (
    <>
      <div className="tour-header">
        <div className="tour-header-left">
          <button
            ref={pickerButtonRef}
            type="button"
            className="picker-button"
            aria-label="Switch tour"
            title="Switch tour"
            onClick={openPicker}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M2 4 H12 M2 7 H12 M2 10 H12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </button>
          <h1 className={titleIsEmpty ? "untitled" : undefined}>
            {tourMeta.title || "(untitled)"}
          </h1>
          <span className="tour-refs">
            {tourMeta.base_source} ← {tourMeta.head_source}
          </span>
        </div>
        <div className="tour-header-right">
          <SequencePill
            idx={currentIdx}
            total={topLevel.length}
            onPrev={() => navigateBy(-1)}
            onNext={() => navigateBy(1)}
          />
          <TourStatsIndicator
            additions={tourStats.additions}
            deletions={tourStats.deletions}
          />
          <LayoutToggle layout={layout} onChange={setLayoutChoice} />
        </div>
        <TourHeaderPath path={selectedFile} />
      </div>
      <div className="app-body">
        <aside className="app-sidebar">
          <h2>Files</h2>
          {visibleRows.map((row) =>
            row.kind === "folder" ? (
              <FolderRow key={`d:${row.path}`} row={row} onToggle={toggleFolder} />
            ) : (
              <FileRow
                key={`f:${row.path}`}
                row={row}
                selected={selectedFile === row.path}
                registerRef={registerSidebarRef}
                onSelect={selectFile}
              />
            ),
          )}
        </aside>
        <main className="app-main">
          {snapshotLost ? (
            <div className="banner">
              Snapshot lost — annotations preserved but diff cannot be displayed
            </div>
          ) : null}
          {snapshotLost ? (
            <AnnotationList
              topLevel={topLevel}
              repliesByRoot={repliesByRoot}
              navIndexById={navIndexById}
              navTotal={navTotal}
              cursorCardId={cursorCardId}
              registerAnnotationRef={registerAnnotationRef}
              composerTarget={composerTarget}
              composerBody={composerBody}
              composerError={composerError}
              onComposerBodyChange={onComposerBodyChange}
              onOpenReply={openReplyComposer}
              onSubmit={submitComposer}
              onCancel={closeComposer}
              replyLock={replyLock}
              replyAgent={replyAgent}
              onSendToAgent={sendToAgent}
              onCardClick={setCursorFromCardClick}
            />
          ) : (
            <>
              <style>{FILE_GRID_CSS}</style>
              {parsedFiles.map((f) => {
                const bf = modelFilesByName.get(f.name);
                if (!bf) return null;
                const rows = plannedRowsByFile.get(f.name) ?? [];
                const topLevelComposer =
                  composerTarget &&
                  composerTarget.kind === "top-level" &&
                  composerTarget.file === f.name
                    ? composerTarget
                    : null;
                const composerAnchor = topLevelComposer
                  ? { side: topLevelComposer.side, line_end: topLevelComposer.line_end }
                  : null;
                const composerSlot = topLevelComposer ? (
                  <Composer
                    placeholder="Leave a comment"
                    submitLabel="Comment"
                    body={composerBody}
                    error={composerError}
                    onBodyChange={onComposerBodyChange}
                    onSubmit={submitComposer}
                    onCancel={closeComposer}
                  />
                ) : null;
                const replyTargetId =
                  composerTarget?.kind === "reply" ? composerTarget.replies_to : null;
                return (
                  <FileBlock
                    key={f.name}
                    file={bf}
                    rows={rows}
                    layout={layout}
                    cursor={cursor}
                    onDispatchExpand={dispatchExpand}
                    onRowClick={({ file, side, lineNumber }) =>
                      setCursorFromRowClick(file, side, lineNumber)
                    }
                    onCardClick={setCursorFromCardClick}
                    annotationProps={{
                      registerRef: registerAnnotationRef,
                      composerBody,
                      composerError,
                      onComposerBodyChange,
                      replyTargetId,
                      onOpenReply: openReplyComposer,
                      onSubmitReply: submitComposer,
                      onCancelReply: closeComposer,
                      replyLock,
                      replyAgent,
                      onSendToAgent: sendToAgent,
                      navIndexById,
                      navTotal,
                    }}
                    isCollapsed={isCollapsed(f.name)}
                    onToggleCollapse={() => toggleCollapsed(f.name)}
                    composerAnchor={composerAnchor}
                    composerSlot={composerSlot}
                  />
                );
              })}
            </>
          )}
        </main>
      </div>
      {sessionState.picker.kind === "open" ? (
        <TourPicker
          rows={sessionState.picker.rows}
          cursor={sessionState.picker.cursor}
          currentTourId={tourId}
          onMove={onPickerMove}
          onCommit={onPickerCommit}
          onClose={closePicker}
        />
      ) : null}
    </>
  );
}

// Renders the currently-selected sidebar file's full filesystem path in the
// left cluster of `.tour-header`, prefixed with `·` (U+00B7) to match the
// TUI's separator glyph so the two surfaces feel consistent. Renders
// nothing when no file is selected. The path is echoed verbatim — no
// basename, no app-side truncation; CSS handles horizontal overflow the
// same way it does for the existing title / source-refs siblings.
// Exported so unit tests can mount the slot in isolation.
export function TourHeaderPath({ path }: { path: string | null }): React.JSX.Element | null {
  if (!path) return null;
  return <span className="tour-header-path">{`· ${path}`}</span>;
}

// Tour-level (PR-equivalent) `+N -M` diff-stats indicator for the title bar
// (issue #233 / PRD #212). Display-only — no click handler, no nav role.
// Sides are independently omitted when their count is zero, so pure-addition
// / pure-deletion tours render cleanly (`+12` only, not `+12 -0`). The
// indicator renders nothing when both counts are zero — a tour with no diff
// content is degenerate, and a 0/0 placeholder would be visual noise.
// Exported so unit tests can mount the slot in isolation.
export function TourStatsIndicator({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}): React.JSX.Element | null {
  if (additions <= 0 && deletions <= 0) return null;
  return (
    <span className="tour-stats" aria-label="Tour diff stats">
      {additions > 0 ? (
        <span className="tour-stats-count added">{`+${additions}`}</span>
      ) : null}
      {deletions > 0 ? (
        <span className="tour-stats-count deleted">{`-${deletions}`}</span>
      ) : null}
    </span>
  );
}

interface LayoutToggleProps {
  layout: Layout;
  onChange: (next: Layout) => void;
}

function LayoutToggle({ layout, onChange }: LayoutToggleProps): React.JSX.Element {
  return (
    <div className="layout-toggle" role="group" aria-label="Diff layout">
      <button
        type="button"
        className={`layout-toggle-btn${layout === "split" ? " active" : ""}`}
        aria-pressed={layout === "split"}
        onClick={() => onChange("split")}
      >
        Split
      </button>
      <button
        type="button"
        className={`layout-toggle-btn${layout === "unified" ? " active" : ""}`}
        aria-pressed={layout === "unified"}
        onClick={() => onChange("unified")}
      >
        Unified
      </button>
    </div>
  );
}

interface FolderRowProps {
  row: Extract<VisibleRow<BundleFile>, { kind: "folder" }>;
  onToggle: (path: string) => void;
}

// React.memo so cursor / annotation-nav state changes in App don't re-render
// every sidebar row. Without this, the plain function rendered ~800 times per
// annotation click despite none of its props meaningfully changing.
// Exported so unit tests can mount the row in isolation.
export const FolderRow = React.memo(function FolderRow({
  row,
  onToggle,
}: FolderRowProps): React.JSX.Element {
  const Chevron = row.collapsed ? ChevronRightIcon : ChevronDownIcon;
  const handleClick = useCallback(() => onToggle(row.path), [onToggle, row.path]);
  return (
    <button
      type="button"
      className="folder-entry"
      style={{ paddingLeft: 16 + row.depth * 16 }}
      title={row.path}
      onClick={handleClick}
    >
      <Chevron className="tree-icon" />
      <FileDirectoryFillIcon className="tree-icon" />
      <span className="folder-name">{row.displayName}</span>
    </button>
  );
});

interface FileRowProps {
  row: Extract<VisibleRow<BundleFile>, { kind: "file" }>;
  selected: boolean;
  // Path-keyed callbacks so a single stable function reference can serve every
  // row; the path is closed over here in a `useCallback` instead of via fresh
  // arrows at the App-render site, which lets `React.memo` actually short-circuit.
  onSelect: (name: string) => void;
  registerRef: (path: string, el: HTMLButtonElement | null) => void;
}

export const FileRow = React.memo(function FileRow({
  row,
  selected,
  onSelect,
  registerRef,
}: FileRowProps): React.JSX.Element {
  const { Icon, statusClass } = fileIcon(row.file.type);
  const handleRef = useCallback(
    (el: HTMLButtonElement | null) => registerRef(row.path, el),
    [registerRef, row.path],
  );
  const handleClick = useCallback(() => onSelect(row.path), [onSelect, row.path]);
  return (
    <button
      ref={handleRef}
      type="button"
      className={`file-entry${selected ? " selected" : ""}`}
      style={{ paddingLeft: 16 + row.depth * 16 }}
      title={row.path}
      onClick={handleClick}
    >
      <Icon className={`status-icon ${statusClass}`} />
      <span className="file-name">{row.displayName}</span>
      {row.annotationCount > 0 ? <span className="badge">{row.annotationCount}</span> : null}
    </button>
  );
});

interface AnnotationCardProps {
  annotation: Annotation;
  replies?: Annotation[];
  isCurrent: boolean;
  // 1-based position in the top-level nav order. null when the annotation
  // isn't in topLevel (defensive — shouldn't happen since AnnotationCard
  // only ever renders top-level annotations). Header omits the counter
  // when null or when navTotal is 0.
  navIndex: number | null;
  navTotal: number;
  registerRef?: (id: string, el: HTMLDivElement | null) => void;
  composerBody?: string;
  composerError?: string | null;
  onComposerBodyChange?: (body: string) => void;
  // The annotation id (top-level or inline Reply) currently targeted by
  // the reply composer; null/undefined → composer not open in this card.
  // When set, the composer renders below the matching annotation's
  // action row — top-level beneath the replies list, inline Reply
  // beneath the Reply itself.
  replyTargetId?: string | null;
  // Callbacks now take the annotation id so inline-Reply rows can address
  // themselves (issue #189, PRD #181 story 11). Top-level callers pass
  // the function directly; the action row computes the right id at
  // click time.
  onOpenReply?: (annotationId: string) => void;
  onSubmitReply?: () => void;
  onCancelReply?: () => void;
  replyLock?: ReplyLock | null;
  // Reply-agent name from `--reply-agent <name>` (issue #184, PRD #181).
  // Null/undefined → the "Send to {agent}" affordance is hidden.
  replyAgent?: string | null;
  onSendToAgent?: (annotationId: string) => void;
  // Cursor-landing callback (PRD #192 / ADR 0022 slice 2). Fires when the
  // user clicks anywhere on the card so the cursor follows the click — a
  // subsequent keyboard `r` / `s` then targets the same card. Receives the
  // top-level annotation id (the cursor stop), not any clicked Reply id.
  onCardClick?: (annotationId: string) => void;
}

// Owns its own 1Hz tick so the wall-clock advances only here. The previous
// design lifted `now` to App and threaded it through every FileBlock /
// AnnotationCard, which meant the whole tree re-rendered each second whenever
// a reply was in-flight. With the tick local, only the pill itself re-renders.
function ReplyPill({ lock }: { lock: ReplyLock }): React.JSX.Element {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(handle);
  }, []);
  const seconds = Math.floor(ageMs(lock, now) / 1000);
  if (isStale(lock, now)) {
    return (
      <div className="reply-pill stale" role="status">
        <span className="reply-pill-icon" aria-hidden="true">⚠️</span>
        <span>
          <strong>{lock.agent}</strong> is taking unusually long…
        </span>
      </div>
    );
  }
  return (
    <div className="reply-pill" role="status">
      <span className="reply-pill-icon" aria-hidden="true">✏️</span>
      <span>
        <strong>{lock.agent}</strong> is replying… ({seconds}s)
      </span>
    </div>
  );
}

function pillTargetsThisCard(
  annotationId: string,
  replies: Annotation[] | undefined,
  lock: ReplyLock,
): boolean {
  if (lock.responding_to === annotationId) return true;
  if (!replies) return false;
  return replies.some((r) => r.id === lock.responding_to);
}

export function AnnotationCard({
  annotation,
  replies,
  isCurrent,
  navIndex,
  navTotal,
  registerRef,
  composerBody = "",
  composerError,
  onComposerBodyChange,
  replyTargetId,
  onOpenReply,
  onSubmitReply,
  onCancelReply,
  replyLock,
  replyAgent,
  onSendToAgent,
  onCardClick,
}: AnnotationCardProps): React.JSX.Element {
  const range =
    annotation.line_start === annotation.line_end
      ? `${annotation.line_start}`
      : `${annotation.line_start}-${annotation.line_end}`;
  const showPill =
    !!replyLock && pillTargetsThisCard(annotation.id, replies, replyLock);
  const lockHeld = replyLock != null;
  const lockedTooltip = replyLock
    ? `${replyLock.agent} is replying — wait`
    : undefined;
  // A Thread carries exactly one action row at the bottom (issue #191).
  // The Reply button targets the latest Annotation in the Thread so a
  // new Reply continues from where the conversation is, not from where
  // it started. The Send button targets the latest human leaf per the
  // unchanged rule from #190 — null when the latest turn is agent
  // (the user must write a human Reply first).
  const descendants = replies ?? [];
  const replyTargetForOpen = latestAnnotationId(annotation, descendants);
  const sendLeafId = latestHumanLeafId(annotation, descendants);
  // The latest leaf is by construction a leaf (hasReply: false); when
  // sendLeafId is non-null it's also human. So the per-Annotation
  // predicate inputs collapse to a fixed shape that depends only on
  // the agent-configured + lock-held axes.
  const sendVerdict: CanSendToAgentResult =
    sendLeafId !== null
      ? canSendToAgent({
          replyAgentConfigured: !!replyAgent,
          lockHeld,
          authorKind: "human",
          hasReply: false,
        })
      : { visible: false, enabled: false };
  const sendTooltip =
    sendVerdict.reason === "lock-held" ? lockedTooltip : undefined;
  const composerOpen = replyTargetId != null;
  const showReplyButton = !!onOpenReply;
  const showSendButton = sendVerdict.visible && !!onSendToAgent && !!sendLeafId;
  return (
    <div
      className={isCurrent ? "annotation-block current" : "annotation-block"}
      ref={(el) => registerRef?.(annotation.id, el)}
      data-annotation-id={annotation.id}
      onClick={() => onCardClick?.(annotation.id)}
    >
      <div className="ann-header">
        {isCurrent ? (
          <span className="selection-marker" aria-hidden="true">●{" "}</span>
        ) : null}
        {navIndex !== null && navTotal > 0 ? (
          <span className="nav-index">{navIndex} / {navTotal}{" "}</span>
        ) : null}
        <span className={`author-kind ${annotation.author_kind}`}>
          [{annotation.author_kind}]
        </span>{" "}
        {annotation.author !== annotation.author_kind ? (
          <>{annotation.author} · </>
        ) : null}
        {annotation.file}:{range}
      </div>
      <div className="ann-body">
        <AnnotationMarkdown body={annotation.body} />
      </div>
      {replies && replies.length > 0 ? (
        <div className="ann-replies">
          {replies.map((r) => (
            <div
              className="ann-reply"
              key={r.id}
              ref={(el) => registerRef?.(r.id, el)}
              id={`annotation-${r.id}`}
            >
              <div className="ann-header">
                <span className={`author-kind ${r.author_kind}`}>
                  [{r.author_kind}]
                </span>
                {r.author !== r.author_kind ? <> {r.author}</> : null}
              </div>
              <div className="ann-body">
                <AnnotationMarkdown body={r.body} />
              </div>
              {replyTargetId === r.id ? (
                <div className="ann-reply-composer">
                  <Composer
                    placeholder="Reply…"
                    submitLabel="Reply"
                    body={composerBody}
                    error={composerError ?? null}
                    onBodyChange={(b) => onComposerBodyChange?.(b)}
                    onSubmit={() => onSubmitReply?.()}
                    onCancel={() => onCancelReply?.()}
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {showPill && replyLock ? <ReplyPill lock={replyLock} /> : null}
      {replyTargetId === annotation.id ? (
        <div className="ann-reply-composer">
          <Composer
            placeholder="Reply…"
            submitLabel="Reply"
            body={composerBody}
            error={composerError ?? null}
            onBodyChange={(b) => onComposerBodyChange?.(b)}
            onSubmit={() => onSubmitReply?.()}
            onCancel={() => onCancelReply?.()}
          />
        </div>
      ) : !composerOpen && (showReplyButton || showSendButton) ? (
        <div className="ann-actions">
          {showReplyButton && onOpenReply ? (
            <button
              type="button"
              className="reply-button"
              onClick={(e) => {
                e.stopPropagation();
                // Land the cursor on this card so a follow-up keyboard `r`
                // / `s` targets it (PRD #192 / ADR 0022 slice 2).
                onCardClick?.(annotation.id);
                onOpenReply(replyTargetForOpen);
              }}
            >
              Reply
            </button>
          ) : null}
          {showSendButton && onSendToAgent && sendLeafId ? (
            <button
              type="button"
              className="send-to-agent-button"
              disabled={!sendVerdict.enabled}
              title={sendTooltip}
              onClick={(e) => {
                e.stopPropagation();
                onCardClick?.(annotation.id);
                if (sendVerdict.enabled) onSendToAgent(sendLeafId);
              }}
            >
              Send to {replyAgent}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface ComposerProps {
  placeholder: string;
  submitLabel: string;
  body: string;
  error: string | null;
  onBodyChange: (body: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

// Controlled textarea reading `body` from the Tour-session store's
// composer slice (PRD #234 slice 3, issue #238). The local
// `useState<string>("")` is gone: every keystroke dispatches
// `composer.setBody` so the watcher-reload-doesn't-eat-the-draft
// invariant is a property of the reducer, not a React-reconciliation
// accident.
function Composer({
  placeholder,
  submitLabel,
  body,
  error,
  onBodyChange,
  onSubmit,
  onCancel,
}: ComposerProps): React.JSX.Element {
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    taRef.current?.focus();
  }, []);

  const trimmed = body.trim();
  const canSubmit = trimmed.length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div
      className="composer"
      onClick={(e) => e.stopPropagation()}
    >
      <textarea
        ref={taRef}
        className="composer-textarea"
        value={body}
        onChange={(e) => onBodyChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        rows={3}
      />
      {error ? <div className="composer-error">{error}</div> : null}
      <div className="composer-actions">
        <button
          type="button"
          className="composer-cancel"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="composer-submit"
          disabled={!canSubmit}
          onClick={submit}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

interface AnnotationListProps {
  topLevel: Annotation[];
  repliesByRoot: Map<string, Annotation[]>;
  navIndexById: Map<string, number>;
  navTotal: number;
  cursorCardId: string | null;
  registerAnnotationRef: (id: string, el: HTMLDivElement | null) => void;
  composerTarget: ComposerTarget | null;
  composerBody: string;
  composerError: string | null;
  onComposerBodyChange: (body: string) => void;
  onOpenReply: (replies_to: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  replyLock: ReplyLock | null;
  replyAgent?: string | null;
  onSendToAgent: (annotationId: string) => void;
  onCardClick: (annotationId: string) => void;
}

function AnnotationList({
  topLevel,
  repliesByRoot,
  navIndexById,
  navTotal,
  cursorCardId,
  registerAnnotationRef,
  composerTarget,
  composerBody,
  composerError,
  onComposerBodyChange,
  onOpenReply,
  onSubmit,
  onCancel,
  replyLock,
  replyAgent,
  onSendToAgent,
  onCardClick,
}: AnnotationListProps): React.JSX.Element {
  if (topLevel.length === 0) return <div className="empty">No annotations</div>;
  return (
    <>
      {topLevel.map((a) => {
        const replies = repliesByRoot.get(a.id) ?? [];
        const replyTargetId =
          composerTarget?.kind === "reply" &&
          (composerTarget.replies_to === a.id ||
            replies.some((r) => r.id === composerTarget.replies_to))
            ? composerTarget.replies_to
            : null;
        return (
          <AnnotationCard
            key={a.id}
            annotation={a}
            replies={replies}
            isCurrent={a.id === cursorCardId}
            navIndex={navIndexById.get(a.id) ?? null}
            navTotal={navTotal}
            registerRef={registerAnnotationRef}
            replyTargetId={replyTargetId}
            composerBody={replyTargetId !== null ? composerBody : ""}
            composerError={replyTargetId !== null ? composerError : null}
            onComposerBodyChange={onComposerBodyChange}
            onOpenReply={onOpenReply}
            onSubmitReply={onSubmit}
            onCancelReply={onCancel}
            replyLock={replyLock}
            replyAgent={replyAgent}
            onSendToAgent={onSendToAgent}
            onCardClick={onCardClick}
          />
        );
      })}
    </>
  );
}

interface SequencePillProps {
  idx: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

function SequencePill({ idx, total, onPrev, onNext }: SequencePillProps): React.JSX.Element | null {
  if (total === 0) return null;
  // idx === -1 ⇔ cursor is on a row (or null) — both chevrons stay live so
  // a single keystroke from a row cursor advances onto the first/last card
  // (PRD #192 / ADR 0022 mirroring the TUI's `—/M` treatment).
  const offCard = idx === -1;
  const prevDisabled = !offCard && idx <= 0;
  const nextDisabled = !offCard && idx >= total - 1;
  return (
    <div className="sequence-pill" role="navigation" aria-label="Annotation navigation">
      <button
        type="button"
        className="pill-chevron"
        onClick={onPrev}
        disabled={prevDisabled}
        aria-label="Previous annotation"
      >
        ‹
      </button>
      <span className="pill-position">
        {offCard ? "—" : idx + 1} / {total}
      </span>
      <button
        type="button"
        className="pill-chevron"
        onClick={onNext}
        disabled={nextDisabled}
        aria-label="Next annotation"
      >
        ›
      </button>
    </div>
  );
}

