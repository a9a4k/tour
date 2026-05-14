import { describe, it, expect } from "vitest";
import { headerSourcePair } from "../../src/core/header-source-pair.js";
import type { Tour } from "../../src/core/types.js";

// Issue #308: shared formatter for the always-visible web + TUI header
// source pair. Format: `<base[:7]> ← <head[:7]>` for non-WIP tours;
// `<base[:7]> ← WIP` for tours with `wip_snapshot === true`.

function makeTour(overrides: Partial<Tour> = {}): Tour {
  return {
    id: "2026-05-14-000000-test",
    title: "Test",
    status: "open",
    created_at: "2026-05-14T00:00:00Z",
    closed_at: "",
    head_sha: "deadbeefcafebabe0000000000000000abcdef12",
    base_sha: "cafebabe1234567800000000000000009876fedc",
    head_source: "feature/x",
    base_source: "main",
    wip_snapshot: false,
    ...overrides,
  };
}

describe("headerSourcePair (issue #308)", () => {
  it("renders `<base[:7]> ← <head[:7]>` for a non-WIP tour", () => {
    const tour = makeTour();
    expect(headerSourcePair(tour)).toBe("cafebab ← deadbee");
  });

  it("slices SHAs to exactly 7 chars (git default short-SHA length)", () => {
    const tour = makeTour({
      head_sha: "1234567890abcdef",
      base_sha: "fedcba0987654321",
    });
    const result = headerSourcePair(tour);
    expect(result).toBe("fedcba0 ← 1234567");
    // Strip the ` ← ` separator and confirm both halves are exactly 7 chars.
    const [base, head] = result.split(" ← ");
    expect(base).toHaveLength(7);
    expect(head).toHaveLength(7);
  });

  it("renders the literal 'WIP' on the head side when wip_snapshot === true", () => {
    const tour = makeTour({ wip_snapshot: true });
    expect(headerSourcePair(tour)).toBe("cafebab ← WIP");
  });

  it("base side stays a short SHA even on a WIP tour (only head is special-cased)", () => {
    const tour = makeTour({ wip_snapshot: true });
    expect(headerSourcePair(tour)).toMatch(/^[0-9a-f]{7} ← WIP$/);
  });

  it("discriminates WIP by the wip_snapshot boolean, not by head_source === 'WIP'", () => {
    // head_source is the literal string "WIP" but wip_snapshot is false —
    // a non-WIP tour that happens to carry "WIP" as the user-typed ref name.
    // The header MUST treat this as a non-WIP tour (short SHA on head side).
    const tour = makeTour({ head_source: "WIP", wip_snapshot: false });
    expect(headerSourcePair(tour)).toBe("cafebab ← deadbee");

    // Inverse: wip_snapshot is true but head_source is the actual ref the
    // user typed (e.g. "HEAD"). The header MUST render "WIP" regardless.
    const wipTour = makeTour({ head_source: "HEAD", wip_snapshot: true });
    expect(headerSourcePair(wipTour)).toBe("cafebab ← WIP");
  });

  it("never echoes head_source or base_source into the rendered pair", () => {
    // The whole point of issue #308 is to drop the ref names from the
    // header — if either source string leaked through this helper, the
    // re-opened-tour misread bug would come right back.
    const tour = makeTour({
      head_source: "feature/some-distinctive-branch-name",
      base_source: "release-candidate-9999",
    });
    const result = headerSourcePair(tour);
    expect(result).not.toContain("feature/some-distinctive-branch-name");
    expect(result).not.toContain("release-candidate-9999");
  });
});
