import { describe, it, expect } from "vitest";
import { buildPickerRows, pickAutoTour } from "../../src/core/tour-list.js";
import type { Tour } from "../../src/core/types.js";

const NOW = Date.parse("2026-05-09T12:00:00Z");

function tour(over: Partial<Tour> & { id: string; created_at: string }): Tour {
  return {
    id: over.id,
    title: over.title ?? "T",
    status: over.status ?? "open",
    created_at: over.created_at,
    closed_at: over.closed_at ?? "",
    head_sha: "h",
    base_sha: "b",
    head_source: "h",
    base_source: "b",
    wip_snapshot: false,
  };
}

function ago(seconds: number): string {
  return new Date(NOW - seconds * 1000).toISOString();
}

describe("buildPickerRows", () => {
  it("sorts newest-first by created_at", () => {
    const rows = buildPickerRows({
      tours: [
        tour({ id: "a", created_at: ago(2 * 60 * 60) }), // 2h ago
        tour({ id: "b", created_at: ago(30 * 60) }), // 30m ago
        tour({ id: "c", created_at: ago(5 * 60) }), // 5m ago
      ],
      commentCounts: {},
      now: NOW,
    });
    expect(rows.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("maps status to glyph: open → ●, closed → ○", () => {
    const rows = buildPickerRows({
      tours: [
        tour({ id: "a", created_at: ago(60), status: "open" }),
        tour({ id: "b", created_at: ago(120), status: "closed" }),
      ],
      commentCounts: {},
      now: NOW,
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get("a")?.glyph).toBe("●");
    expect(byId.get("b")?.glyph).toBe("○");
    expect(byId.get("a")?.status).toBe("open");
    expect(byId.get("b")?.status).toBe("closed");
  });

  it("formats relative-time across all boundary scales", () => {
    const cases: Array<[number, string]> = [
      [10, "just now"],
      [59, "just now"],
      [60, "1m ago"],
      [5 * 60, "5m ago"],
      [60 * 60, "1h ago"],
      [3 * 60 * 60, "3h ago"],
      [24 * 60 * 60, "1d ago"],
      [3 * 24 * 60 * 60, "3d ago"],
      [7 * 24 * 60 * 60, "1w ago"],
      [21 * 24 * 60 * 60, "3w ago"],
      [30 * 24 * 60 * 60, "1mo ago"],
      [120 * 24 * 60 * 60, "4mo ago"],
      [365 * 24 * 60 * 60, "1y ago"],
      [3 * 365 * 24 * 60 * 60, "3y ago"],
    ];
    for (const [secs, expected] of cases) {
      const rows = buildPickerRows({
        tours: [tour({ id: "x", created_at: ago(secs) })],
        commentCounts: {},
        now: NOW,
      });
      expect(rows[0].age, `${secs}s ago`).toBe(expected);
    }
  });

  it("falls back to '(untitled)' when title is missing or empty", () => {
    const rows = buildPickerRows({
      tours: [
        tour({ id: "a", title: "", created_at: ago(60) }),
        tour({ id: "b", title: "Hello", created_at: ago(120) }),
      ],
      commentCounts: {},
      now: NOW,
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get("a")?.title).toBe("(untitled)");
    expect(byId.get("b")?.title).toBe("Hello");
  });

  it("reflects commentCounts and defaults missing entries to 0", () => {
    const rows = buildPickerRows({
      tours: [
        tour({ id: "a", created_at: ago(60) }),
        tour({ id: "b", created_at: ago(120) }),
      ],
      commentCounts: { a: 7 },
      now: NOW,
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get("a")?.commentCount).toBe(7);
    expect(byId.get("b")?.commentCount).toBe(0);
  });

  it("breaks ties on identical created_at deterministically by id", () => {
    const same = ago(60);
    const a = buildPickerRows({
      tours: [
        tour({ id: "zzz", created_at: same }),
        tour({ id: "aaa", created_at: same }),
        tour({ id: "mmm", created_at: same }),
      ],
      commentCounts: {},
      now: NOW,
    });
    const b = buildPickerRows({
      tours: [
        tour({ id: "mmm", created_at: same }),
        tour({ id: "aaa", created_at: same }),
        tour({ id: "zzz", created_at: same }),
      ],
      commentCounts: {},
      now: NOW,
    });
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id));
  });
});

describe("pickAutoTour", () => {
  it("returns null for an empty list", () => {
    expect(pickAutoTour([])).toBeNull();
  });

  it("picks the most-recent open tour", () => {
    const got = pickAutoTour([
      tour({ id: "a", status: "open", created_at: ago(60 * 60) }),
      tour({ id: "b", status: "open", created_at: ago(10 * 60) }),
      tour({ id: "c", status: "open", created_at: ago(30 * 60) }),
    ]);
    expect(got?.id).toBe("b");
  });

  it("ignores closed tours when at least one open exists — even when a closed tour is most-recent overall", () => {
    const got = pickAutoTour([
      tour({ id: "a", status: "open", created_at: ago(60 * 60) }),
      tour({ id: "b", status: "closed", created_at: ago(5 * 60) }),
      tour({ id: "c", status: "open", created_at: ago(30 * 60) }),
    ]);
    expect(got?.id).toBe("c");
  });

  it("returns null when every tour is closed", () => {
    const got = pickAutoTour([
      tour({ id: "a", status: "closed", created_at: ago(10 * 60) }),
      tour({ id: "b", status: "closed", created_at: ago(60 * 60) }),
    ]);
    expect(got).toBeNull();
  });

  it("breaks ties on identical created_at deterministically by id (largest id wins)", () => {
    const same = ago(60);
    const got = pickAutoTour([
      tour({ id: "aaa", status: "open", created_at: same }),
      tour({ id: "zzz", status: "open", created_at: same }),
      tour({ id: "mmm", status: "open", created_at: same }),
    ]);
    expect(got?.id).toBe("zzz");
  });
});
