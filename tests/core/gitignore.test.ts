import { describe, it, expect, beforeEach } from "vitest";
import { ensureTourIgnored } from "../../src/core/gitignore.js";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("ensureTourIgnored", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tour-gitignore-"));
  });

  it("creates .gitignore with .tour/ when none exists", async () => {
    await ensureTourIgnored(dir);
    const content = await readFile(join(dir, ".gitignore"), "utf-8");
    expect(content).toContain(".tour/");
  });

  it("appends .tour/ to existing .gitignore", async () => {
    await writeFile(join(dir, ".gitignore"), "node_modules/\n");
    await ensureTourIgnored(dir);
    const content = await readFile(join(dir, ".gitignore"), "utf-8");
    expect(content).toContain("node_modules/");
    expect(content).toContain(".tour/");
  });

  it("does not duplicate .tour/ if already present", async () => {
    await writeFile(join(dir, ".gitignore"), ".tour/\n");
    await ensureTourIgnored(dir);
    const content = await readFile(join(dir, ".gitignore"), "utf-8");
    const count = content.split(".tour/").length - 1;
    expect(count).toBe(1);
  });

  it("is idempotent across multiple calls", async () => {
    await ensureTourIgnored(dir);
    await ensureTourIgnored(dir);
    await ensureTourIgnored(dir);
    const content = await readFile(join(dir, ".gitignore"), "utf-8");
    const count = content.split(".tour/").length - 1;
    expect(count).toBe(1);
  });
});
