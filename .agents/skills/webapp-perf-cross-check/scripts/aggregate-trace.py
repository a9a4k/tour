#!/usr/bin/env python3
"""Aggregate main-thread cost from a Chrome DevTools trace.

Usage:
    python3 aggregate-trace.py <trace.json> [<label>]

Reads a Chrome DevTools `traceEvents` JSON (the format `agent-browser trace stop`
saves). Identifies the renderer process by main-thread RunTask totals — handy
when extensions also run in their own renderers and you want the page's, not
theirs. Then sums duration per Chrome event name and per `EventDispatch:<type>`.

Output is one screen of plain text: top main-thread totals + per-EventDispatch
totals + a one-line summary of the metrics the cross-check skill targets
(EventDispatch:click/keydown, Layout, Paint, HitTest).
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    path = argv[1]
    label = argv[2] if len(argv) > 2 else path

    with open(path) as f:
        data = json.load(f)
    events = data.get("traceEvents", data) if isinstance(data, dict) else data

    # Identify renderer process + main thread by busiest main thread.
    pname: dict[int, str] = {}
    tname: dict[tuple[int, int], str] = {}
    for e in events:
        if e.get("ph") != "M":
            continue
        if e.get("name") == "process_name":
            pname[e["pid"]] = e["args"].get("name")
        elif e.get("name") == "thread_name":
            tname[(e["pid"], e["tid"])] = e["args"].get("name")

    renderer_pids = [p for p, n in pname.items() if n == "Renderer"]
    main_tids: dict[int, int] = {}
    for (pid, tid), n in tname.items():
        if pid in renderer_pids and n == "CrRendererMain":
            main_tids[pid] = tid

    loads = {
        pid: sum(
            e.get("dur", 0)
            for e in events
            if e.get("pid") == pid
            and e.get("tid") == tid
            and e.get("ph") == "X"
            and e.get("name") == "RunTask"
        )
        for pid, tid in main_tids.items()
    }
    if not loads:
        print(f"{label}: no renderer main thread found", file=sys.stderr)
        return 1
    pid = max(loads, key=loads.get)
    tid = main_tids[pid]

    # Main-thread totals (excluding the RunTask wrapper itself).
    totals: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for e in events:
        if e.get("pid") != pid or e.get("tid") != tid or e.get("ph") != "X":
            continue
        name = e.get("name")
        if name == "RunTask":
            continue
        totals[name][0] += 1
        totals[name][1] += e.get("dur", 0)

    # EventDispatch broken out by JS type.
    by_type: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for e in events:
        if e.get("pid") != pid or e.get("name") != "EventDispatch" or e.get("ph") != "X":
            continue
        t = e.get("args", {}).get("data", {}).get("type", "?")
        by_type[t][0] += 1
        by_type[t][1] += e.get("dur", 0)

    print(f"=== {label} ===")
    print(f"  (pid={pid}, main-thread load {loads[pid] / 1000:.1f} ms)\n")

    print("Top main-thread totals:")
    rows = sorted(totals.items(), key=lambda kv: -kv[1][1])
    for name, (count, dur) in rows[:15]:
        print(f"  {dur / 1000:9.2f} ms  cnt={count:5d}  {name}")

    print("\nEventDispatch by type:")
    for t, (count, dur) in sorted(by_type.items(), key=lambda kv: -kv[1][1])[:10]:
        print(f"  {dur / 1000:9.2f} ms  cnt={count:5d}  {t}")

    # Cross-check skill targets summary.
    def total(name: str) -> tuple[int, int]:
        c, d = totals.get(name, [0, 0])
        return c, d

    def ev(t: str) -> tuple[int, int]:
        c, d = by_type.get(t, [0, 0])
        return c, d

    print("\nCross-check targets:")
    for label_, (c, d) in (
        ("EventDispatch:click", ev("click")),
        ("EventDispatch:keydown", ev("keydown")),
        ("Layout", total("Layout")),
        ("Paint", total("Paint")),
        ("HitTest", total("HitTest")),
    ):
        print(f"  {label_:22s}  {d / 1000:8.2f} ms  cnt={c}")

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
