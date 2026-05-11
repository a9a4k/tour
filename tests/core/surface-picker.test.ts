import { describe, it, expect } from "vitest";
import { pickDefaultSurface, type SurfaceEnv } from "../../src/core/surface-picker.js";

// Pure surface-picker (issue #174). Asserts the observable choice at the
// function interface — "webapp" or "tui" — given a fully-formed env shape.
// No process.env / process.platform reads here; the caller is responsible
// for collecting real env state and passing it in.

function env(overrides: Partial<SurfaceEnv> = {}): SurfaceEnv {
  return {
    platform: "linux",
    ssh: false,
    isTTY: true,
    hasOpenCommand: true,
    ...overrides,
  };
}

describe("pickDefaultSurface", () => {
  it("picks webapp on linux with TTY + opener + no ssh", () => {
    expect(pickDefaultSurface(env())).toBe("webapp");
  });

  it("picks webapp on darwin with TTY + opener + no ssh", () => {
    expect(pickDefaultSurface(env({ platform: "darwin" }))).toBe("webapp");
  });

  it("picks tui when ssh is set (remote machine)", () => {
    expect(pickDefaultSurface(env({ ssh: true }))).toBe("tui");
  });

  it("picks tui when isTTY is false (piped output)", () => {
    expect(pickDefaultSurface(env({ isTTY: false }))).toBe("tui");
  });

  it("picks tui on win32 (no webapp opener wired today)", () => {
    expect(pickDefaultSurface(env({ platform: "win32" }))).toBe("tui");
  });

  it("picks tui when hasOpenCommand is false (no open / xdg-open available)", () => {
    expect(pickDefaultSurface(env({ hasOpenCommand: false }))).toBe("tui");
  });

  it("ssh wins over a happy desktop env", () => {
    expect(
      pickDefaultSurface(env({ platform: "darwin", ssh: true, hasOpenCommand: true })),
    ).toBe("tui");
  });

  it("non-TTY wins over a happy desktop env", () => {
    expect(
      pickDefaultSurface(env({ platform: "darwin", isTTY: false, hasOpenCommand: true })),
    ).toBe("tui");
  });
});
