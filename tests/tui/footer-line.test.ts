import { describe, it, expect, vi } from "vitest";

vi.mock("@opentui/core", () => ({
  RGBA: { fromHex: () => ({}) },
  SyntaxStyle: { fromStyles: () => ({ tokens: {} }) },
  pathToFiletype: () => undefined,
}));

import { FooterLineTui } from "../../src/tui/FooterLine.js";

interface AnyElement {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
}

function isElement(node: unknown): node is AnyElement {
  return typeof node === "object" && node !== null && "type" in node && "props" in node;
}

describe("FooterLineTui", () => {
  it("keeps footer hints and transient status text selectable", () => {
    const out = FooterLineTui({ footer: "Copied selection  ·  j/k: move" });
    if (!isElement(out)) throw new Error("FooterLineTui did not return an element");
    const child = out.props.children;

    expect(isElement(child)).toBe(true);
    expect((child as AnyElement).type).toBe("text");
    expect((child as AnyElement).props.children).toBe("Copied selection  ·  j/k: move");
    expect((child as AnyElement).props["selectable"]).not.toBe(false);
  });
});
