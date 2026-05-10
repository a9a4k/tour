import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, chmod, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertAdapterExists,
  buildEnvelope,
  ensureShippedAdapter,
  spawnAdapter,
} from "../../src/core/agent-adapter.js";
import { CLAUDE_ADAPTER_SCRIPT } from "../../src/agents/claude.js";
import { PI_ADAPTER_SCRIPT } from "../../src/agents/pi.js";
import type { Annotation, Tour } from "../../src/core/types.js";

function tour(over: Partial<Tour> = {}): Tour {
  return {
    id: "2026-05-10-120000-test",
    title: "Test",
    status: "open",
    created_at: "2026-05-10T12:00:00Z",
    closed_at: "",
    head_sha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    base_sha: "feedfacefeedfacefeedfacefeedfacefeedface",
    head_source: "HEAD",
    base_source: "HEAD^",
    wip_snapshot: false,
    ...over,
  };
}

function ann(over: Partial<Annotation> & { id: string }): Annotation {
  return {
    id: over.id,
    file: "src/main.ts",
    side: "additions",
    line_start: 10,
    line_end: 10,
    body: "note",
    author: "anonymous",
    author_kind: "agent",
    created_at: "2026-05-10T12:00:00Z",
    ...over,
  };
}

describe("assertAdapterExists", () => {
  it("throws a clear error when the named adapter is missing", () => {
    expect(() => assertAdapterExists("definitely-not-installed-xyz")).toThrow(
      /not found at/,
    );
  });
});

describe("ensureShippedAdapter (first-run bootstrap)", () => {
  let savedHome: string | undefined;
  let fakeHome: string;

  beforeEach(async () => {
    fakeHome = await mkdtemp(join(tmpdir(), "tour-fakehome-"));
    savedHome = process.env.HOME;
    process.env.HOME = fakeHome;
  });

  afterEach(() => {
    if (savedHome !== undefined) process.env.HOME = savedHome;
    else delete process.env.HOME;
  });

  it("writes the shipped claude adapter to ~/.config/tour/agents/claude.sh on first run", async () => {
    ensureShippedAdapter("claude");
    const path = join(fakeHome, ".config", "tour", "agents", "claude.sh");
    expect(existsSync(path)).toBe(true);
    const contents = await readFile(path, "utf-8");
    expect(contents).toBe(CLAUDE_ADAPTER_SCRIPT);
    const st = await stat(path);
    // Owner-executable. Node masks the high bits on some platforms; checking
    // the +x bit is the portable assertion.
    expect(st.mode & 0o111).not.toBe(0);
  });

  it("does not overwrite a user-edited adapter script on subsequent runs", async () => {
    ensureShippedAdapter("claude");
    const path = join(fakeHome, ".config", "tour", "agents", "claude.sh");
    await writeFile(path, "#!/usr/bin/env bash\n# user-customized\n");
    ensureShippedAdapter("claude");
    const after = await readFile(path, "utf-8");
    expect(after).toBe("#!/usr/bin/env bash\n# user-customized\n");
  });

  it("writes the shipped pi adapter to ~/.config/tour/agents/pi.sh on first run", async () => {
    ensureShippedAdapter("pi");
    const path = join(fakeHome, ".config", "tour", "agents", "pi.sh");
    expect(existsSync(path)).toBe(true);
    const contents = await readFile(path, "utf-8");
    expect(contents).toBe(PI_ADAPTER_SCRIPT);
    const st = await stat(path);
    expect(st.mode & 0o111).not.toBe(0);
  });

  it("is a no-op for adapter names not in the shipped registry", () => {
    ensureShippedAdapter("custom-not-shipped");
    const path = join(fakeHome, ".config", "tour", "agents", "custom-not-shipped.sh");
    expect(existsSync(path)).toBe(false);
  });
});

describe("buildEnvelope", () => {
  it("packs the full thread chain when triggering on a reply", () => {
    const root = ann({ id: "a1" });
    const r1 = ann({
      id: "a2",
      replies_to: "a1",
      author_kind: "human",
      created_at: "2026-05-10T12:00:01Z",
    });
    const r2 = ann({
      id: "a3",
      replies_to: "a1",
      author_kind: "agent",
      created_at: "2026-05-10T12:00:02Z",
    });
    const env = buildEnvelope(tour(), [root, r1, r2], r1);
    expect(env.tour.id).toBe("2026-05-10-120000-test");
    expect(env.triggering_annotation.id).toBe("a2");
    expect(env.thread.map((a) => a.id)).toEqual(["a1", "a2", "a3"]);
  });

  it("packs just the root when triggering on a top-level annotation", () => {
    const root = ann({ id: "a1" });
    const env = buildEnvelope(tour(), [root], root);
    expect(env.thread.map((a) => a.id)).toEqual(["a1"]);
  });
});

describe("spawnAdapter (integration with a fake adapter)", () => {
  let dir: string;
  let adapter: string;
  let stdinFile: string;
  let envFile: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tour-adapter-"));
    adapter = join(dir, "fake.sh");
    stdinFile = join(dir, "stdin.json");
    envFile = join(dir, "env.txt");
    // Fake adapter: dump stdin to one file, TOUR_* env vars to another, exit 0.
    // Lets the test assert envelope shape and env vars without process probing.
    const script = `#!/usr/bin/env bash
set -e
cat > "${stdinFile}"
{
  echo "TOUR_ID=$TOUR_ID"
  echo "TOUR_HEAD_SHA=$TOUR_HEAD_SHA"
  echo "TOUR_BASE_SHA=$TOUR_BASE_SHA"
  echo "TOUR_DIR=$TOUR_DIR"
} > "${envFile}"
exit 0
`;
    await writeFile(adapter, script);
    await chmod(adapter, 0o755);
  });

  it("invokes the adapter with the envelope on stdin and TOUR_* in env", async () => {
    const t = tour();
    const triggering = ann({ id: "a1", author_kind: "human" });
    const envelope = buildEnvelope(t, [triggering], triggering);
    const tourDir = join(dir, ".tour", t.id);
    await mkdir(tourDir, { recursive: true });

    const spawned = spawnAdapter({
      agent: "fake",
      envelope,
      cwd: dir,
      tourDir,
      adapterPath: adapter,
    });
    expect(spawned.pid).toBeGreaterThan(0);
    const { code } = await spawned.exit;
    expect(code).toBe(0);

    const stdinJson = JSON.parse(await readFile(stdinFile, "utf-8"));
    expect(stdinJson.triggering_annotation.id).toBe("a1");
    expect(stdinJson.tour.id).toBe(t.id);
    expect(stdinJson.thread).toHaveLength(1);

    const envText = await readFile(envFile, "utf-8");
    expect(envText).toContain(`TOUR_ID=${t.id}`);
    expect(envText).toContain(`TOUR_HEAD_SHA=${t.head_sha}`);
    expect(envText).toContain(`TOUR_BASE_SHA=${t.base_sha}`);
    expect(envText).toContain(`TOUR_DIR=${tourDir}`);
  });
});
