import { describe, it, expect, vi } from "vitest";

// Stub @opentui/core for the same reason diff-rows.test.ts does — the
// module eagerly loads tree-sitter highlights .scm assets at init.
vi.mock("@opentui/core", () => ({
  RGBA: { fromHex: () => ({}) },
  SyntaxStyle: { fromStyles: () => ({ tokens: {} }) },
  pathToFiletype: () => undefined,
}));

import { FileSeparator, withFileSeparators } from "../../src/tui/FileSeparator.js";
import { theme } from "../../src/core/theme.js";

interface AnyElement {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
}

function isElement(node: unknown): node is AnyElement {
  return typeof node === "object" && node !== null && "type" in node && "props" in node;
}

function flatten(node: unknown, out: AnyElement[] = []): AnyElement[] {
  if (Array.isArray(node)) {
    for (const c of node) flatten(c, out);
    return out;
  }
  if (!isElement(node)) return out;
  out.push(node);
  flatten(node.props.children, out);
  return out;
}

describe("FileSeparator (issue #263)", () => {
  it("renders a horizontal rule row of '─' characters in theme.border.muted", () => {
    const tree = FileSeparator();
    const elements = flatten(tree);
    const texts = elements.filter((el) => el.type === "text");
    expect(texts.length).toBe(1);
    const text = texts[0];
    expect(text.props.fg).toBe(theme.border.muted);
    const children = text.props.children;
    expect(typeof children).toBe("string");
    expect((children as string).length).toBeGreaterThanOrEqual(80);
    // every character is U+2500
    expect(new Set(children as string)).toEqual(new Set(["─"]));
  });

  it("uses wrapMode='none' so a long rule doesn't wrap into multiple lines", () => {
    const tree = FileSeparator();
    const texts = flatten(tree).filter((el) => el.type === "text");
    expect(texts[0].props.wrapMode).toBe("none");
  });

  it("includes a 1-row blank below the rule so consecutive files have breathing room", () => {
    // The file card above already supplies its own marginBottom (1 row),
    // so the separator only carries the rule + a blank below. Total height
    // contributed by the separator block = 2 rows.
    const tree = FileSeparator();
    expect(isElement(tree)).toBe(true);
    if (!isElement(tree)) return;
    const children = Array.isArray(tree.props.children)
      ? tree.props.children
      : [tree.props.children];
    const elements = children.filter(isElement);
    expect(elements.length).toBe(2);
    // First child: the rule row (height 1, contains the text).
    expect(elements[0].props.height).toBe(1);
    expect(elements[0].props.width).toBe("100%");
    // Second child: blank spacer below the rule (height 1, no text).
    expect(elements[1].props.height).toBe(1);
    expect(flatten(elements[1]).filter((el) => el.type === "text").length).toBe(0);
  });
});

describe("withFileSeparators (issue #263)", () => {
  const renderCard = (file: { name: string }) => ({
    type: "box" as const,
    props: { id: `card-${file.name}`, children: null },
    key: file.name,
  } as unknown as import("react").ReactElement);

  it("returns an empty array for an empty file list", () => {
    expect(withFileSeparators([], renderCard)).toEqual([]);
  });

  it("renders a single file with no separator", () => {
    const out = withFileSeparators([{ name: "a.txt" }], renderCard);
    expect(out.length).toBe(1);
    const seps = out.filter((n) => isElement(n) && n.type === FileSeparator);
    expect(seps.length).toBe(0);
  });

  it("inserts one separator between two files", () => {
    const out = withFileSeparators([{ name: "a.txt" }, { name: "b.txt" }], renderCard);
    expect(out.length).toBe(3);
    // [card, separator, card]
    expect(isElement(out[0]) && (out[0] as AnyElement).props.id).toBe("card-a.txt");
    expect(isElement(out[1]) && (out[1] as AnyElement).type).toBe(FileSeparator);
    expect(isElement(out[2]) && (out[2] as AnyElement).props.id).toBe("card-b.txt");
  });

  it("inserts two separators between three files", () => {
    const out = withFileSeparators(
      [{ name: "a.txt" }, { name: "b.txt" }, { name: "c.txt" }],
      renderCard,
    );
    expect(out.length).toBe(5);
    // [card, sep, card, sep, card]
    expect(isElement(out[0]) && (out[0] as AnyElement).props.id).toBe("card-a.txt");
    expect(isElement(out[1]) && (out[1] as AnyElement).type).toBe(FileSeparator);
    expect(isElement(out[2]) && (out[2] as AnyElement).props.id).toBe("card-b.txt");
    expect(isElement(out[3]) && (out[3] as AnyElement).type).toBe(FileSeparator);
    expect(isElement(out[4]) && (out[4] as AnyElement).props.id).toBe("card-c.txt");
  });

  it("never emits a separator before the first file or after the last", () => {
    const out = withFileSeparators(
      [{ name: "a.txt" }, { name: "b.txt" }, { name: "c.txt" }],
      renderCard,
    );
    // First and last positions must be a card, never a separator.
    expect(isElement(out[0]) && (out[0] as AnyElement).type).not.toBe(FileSeparator);
    expect(
      isElement(out[out.length - 1]) && (out[out.length - 1] as AnyElement).type,
    ).not.toBe(FileSeparator);
  });

  it("gives each separator a unique React key keyed off the preceding file", () => {
    const out = withFileSeparators(
      [{ name: "a.txt" }, { name: "b.txt" }, { name: "c.txt" }],
      renderCard,
    );
    const seps = out.filter((n) => isElement(n) && n.type === FileSeparator) as AnyElement[];
    expect(seps.length).toBe(2);
    const keys = seps.map((s) => (s as unknown as { key?: string }).key);
    expect(new Set(keys).size).toBe(2);
    keys.forEach((k) => expect(typeof k).toBe("string"));
  });
});
