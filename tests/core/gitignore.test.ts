import { describe, it, expect, beforeEach } from "vitest";
import { ensureReviewIgnored } from "../../src/core/gitignore.js";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("ensureReviewIgnored", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "review-gitignore-"));
  });

  it("creates .gitignore with .review/ when none exists", async () => {
    await ensureReviewIgnored(dir);
    const content = await readFile(join(dir, ".gitignore"), "utf-8");
    expect(content).toContain(".review/");
  });

  it("appends .review/ to existing .gitignore", async () => {
    await writeFile(join(dir, ".gitignore"), "node_modules/\n");
    await ensureReviewIgnored(dir);
    const content = await readFile(join(dir, ".gitignore"), "utf-8");
    expect(content).toContain("node_modules/");
    expect(content).toContain(".review/");
  });

  it("does not duplicate .review/ if already present", async () => {
    await writeFile(join(dir, ".gitignore"), ".review/\n");
    await ensureReviewIgnored(dir);
    const content = await readFile(join(dir, ".gitignore"), "utf-8");
    const count = content.split(".review/").length - 1;
    expect(count).toBe(1);
  });

  it("is idempotent across multiple calls", async () => {
    await ensureReviewIgnored(dir);
    await ensureReviewIgnored(dir);
    await ensureReviewIgnored(dir);
    const content = await readFile(join(dir, ".gitignore"), "utf-8");
    const count = content.split(".review/").length - 1;
    expect(count).toBe(1);
  });
});
