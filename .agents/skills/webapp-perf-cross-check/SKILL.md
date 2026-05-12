---
name: webapp-perf-cross-check
metadata:
  internal: true
description: Cross-check methodology for diagnosing webapp re-render cascades. React DevTools' "DOM commit" column counts fiber commits, not real browser mutations — it can overstate cost by 100×. Always verify against a Chrome trace (Layout/Paint/EventDispatch durations) and a MutationObserver (actual mutations) before chasing a cascade. Use when profiling webapp lag, suspected re-render storms, slow interactions, or whenever React DevTools shows high render counts but the page feels fine. Pairs with the diagnose skill — this is the "instrument" phase for React perf.
---

# Webapp perf cross-check

## Prerequisites

The React-renders instrument requires `agent-browser` to be opened with React DevTools enabled:

```bash
agent-browser open <url> --enable react-devtools
```

Without this flag, `react renders start` fails with a non-obvious error about the DevTools hook not being installed. Chrome trace and MutationObserver work without it.

## The trap

React DevTools' render profile reports a `DOM` column per component (e.g. `320/325`). **It counts fiber commits, not browser DOM mutations.** A component can show "320 DOM updates" while the actual browser performed zero. React schedules a commit, the reconciler diffs the new tree against the old, finds nothing to update, but the profiler still ticks the counter.

Treat React DevTools render counts as a *hypothesis*, never as evidence of real cost. Confirm with browser-side signals before writing any patch.

## Cross-check pattern

Run all three before deciding a cascade is real. agent-browser supports all three.

### 1. React renders (fiber commits — often inflated)

```bash
agent-browser react renders start
# ... do the action ...
agent-browser react renders stop --json
```

Note the `Re-renders` and `DOM` columns *and the change reasons* — they tell you which prop / state changed, which is the actual diagnostic value.

### 2. Chrome trace (real browser work)

```bash
agent-browser trace start
# ... do the action ...
agent-browser trace stop
# trace is saved under ~/.agent-browser/tmp/traces/trace-<ts>.json
python3 scripts/aggregate-trace.py <path-to-trace.json> "<label>"
```

`scripts/aggregate-trace.py` sums main-thread cost per event name and per `EventDispatch:<type>`, then prints the cross-check targets summary.

Targets per interaction:
- `EventDispatch:click` / `keydown` < 50 ms → no long task
- `Layout` count ≤ 2 per interaction (more = layout thrash)
- `Paint` < 16 ms → frame budget intact

### 3. MutationObserver (real DOM mutations)

```bash
agent-browser eval "
  window.__mut = 0;
  const o = new MutationObserver((muts) => { window.__mut += muts.length });
  o.observe(document.body, {childList:true, subtree:true, attributes:true, characterData:true});
  'observing'
"
# ... do the action ...
agent-browser eval "window.__mut"
```

Caveats:
- Doesn't cross shadow-DOM boundaries by default. For shadow-DOM-heavy components (e.g. Pierre's `<diffs-container>`), walk shadow roots and attach an observer to each, or rely on the Chrome trace instead.
- `attributes:true` is noisy on hover/focus styling — reset the counter immediately before the action.

## Decision rule

| React renders | Chrome trace | MutationObserver | Verdict |
|---|---|---|---|
| High | High | High | **Real cascade.** Fix the prop/state churn that's busting `React.memo`. |
| High | Low | Low | **Ghost cascade.** Reconciler short-circuited. Ignore — the user can't feel it. |
| Low | High | — | Cost is outside React's tree (CSS, layout invalidation, paint). Look at browser pipeline, not memoisation. |
| Any | — | High but Chrome low | Cheap mutations (text-only / class flips). Usually fine. |

## Real example — Tour webapp (2026-05-11)

Composer typing in `App.tsx` reply box:

| Signal | Value |
|---|---|
| React DevTools | `MultiFileDiff: 325 re-renders, 320/325 DOM` per 5 keystrokes |
| Chrome trace | `0.86 ms Layout/keystroke, ~10 ms total/keystroke` |
| MutationObserver | **1 mutation per keystroke** |
| FPS | 62 avg, 60 min, 0 drops |

The React profile screamed "650-file cascade per keystroke." Reality: a single text node update. Verdict: ghost cascade, no fix needed.

By contrast, annotation navigation in the same session showed:
- React: 9,313 re-renders / click
- Chrome: 876 ms `EventDispatch:click` for 3 clicks (avg 292 ms — long task)
- FPS: min 1, 27 drops

All three high → real cascade. Fix landed in commit `1bf446d`, click cost dropped to 33 ms.

## When this skill matters most

- Long-task suspicion (handler > 50 ms in trace)
- Comparing patched vs baseline — measure the *user-visible* win, not just the React count
- "Why does the React profile show so many renders but it feels fine?"
- React 18+ concurrent rendering where commits get sliced and counts get noisy
- Before committing a memoisation patch — confirm with browser metrics that it actually helped

## Companion skill

For end-to-end diagnosis loop (reproduce → minimise → hypothesise → fix → regression-test), use the `diagnose` skill. This skill is the "instrument" phase tooling for React-specific perf work.
