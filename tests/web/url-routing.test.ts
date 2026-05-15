import { describe, it, expect } from "vitest";
import {
  readTourFromLocation,
  readAnnFromLocation,
  composeUrl,
} from "../../src/web/client/url-routing.js";

// Issue #179 reopen — the SPA migrates to path + fragment URL parsing so
// `tour serve <id>`'s printed deep URL reaches the right tour even in the
// probe-reuse case (when the running server's HTML still bakes a
// different `__INITIAL_TOUR_ID__`).

describe("readTourFromLocation", () => {
  it("returns the first non-empty path segment", () => {
    expect(readTourFromLocation({ pathname: "/abc", search: "" }, null)).toBe("abc");
    expect(readTourFromLocation({ pathname: "/abc/foo", search: "" }, null)).toBe("abc");
  });

  it("path wins over query", () => {
    expect(readTourFromLocation({ pathname: "/B", search: "?tour=A" }, null)).toBe("B");
  });

  it("path wins over the baked fallback (probe-reuse case)", () => {
    expect(readTourFromLocation({ pathname: "/B", search: "" }, "A")).toBe("B");
  });

  it("query wins over the fallback when path is empty", () => {
    expect(readTourFromLocation({ pathname: "/", search: "?tour=A" }, "Z")).toBe("A");
  });

  it("falls back to the baked global when neither path nor query has an id", () => {
    expect(readTourFromLocation({ pathname: "/", search: "" }, "Z")).toBe("Z");
  });

  it("returns null when nothing is available", () => {
    expect(readTourFromLocation({ pathname: "/", search: "" }, null)).toBeNull();
  });

  it("treats an empty `?tour=` as absent", () => {
    expect(readTourFromLocation({ pathname: "/", search: "?tour=" }, "Z")).toBe("Z");
  });

  it("decodes URL-encoded path segments", () => {
    expect(readTourFromLocation({ pathname: "/a%20b", search: "" }, null)).toBe("a b");
  });
});

describe("readAnnFromLocation", () => {
  it("returns the hash without its leading `#`", () => {
    expect(readAnnFromLocation({ hash: "#ann-1", search: "" })).toBe("ann-1");
  });

  it("fragment wins over query", () => {
    expect(readAnnFromLocation({ hash: "#ann-1", search: "?ann=ann-2" })).toBe("ann-1");
  });

  it("falls back to the legacy `?ann=` query", () => {
    expect(readAnnFromLocation({ hash: "", search: "?ann=ann-2" })).toBe("ann-2");
  });

  it("returns null when neither hash nor query provides an id", () => {
    expect(readAnnFromLocation({ hash: "", search: "" })).toBeNull();
    expect(readAnnFromLocation({ hash: "#", search: "" })).toBeNull();
  });

  it("decodes URL-encoded fragments", () => {
    expect(readAnnFromLocation({ hash: "#a%2Fb", search: "" })).toBe("a/b");
  });
});

describe("composeUrl", () => {
  it("returns `/` when no tour-id is selected", () => {
    expect(composeUrl(null, null)).toBe("/");
    expect(composeUrl(null, "ignored")).toBe("/");
  });

  it("emits `/<tour-id>` when a comment is not selected", () => {
    expect(composeUrl("abc", null)).toBe("/abc");
  });

  it("emits `/<tour-id>#<ann-id>` when both are present", () => {
    expect(composeUrl("abc", "ann-1")).toBe("/abc#ann-1");
  });

  it("encodes ids with reserved characters", () => {
    expect(composeUrl("a b", "c/d")).toBe("/a%20b#c%2Fd");
  });
});
