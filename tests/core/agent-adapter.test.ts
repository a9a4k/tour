import { describe, it, expect } from "vitest";
import {
  buildEnvelope,
  spawnReplyAgent,
  type SpawnedAdapter,
  type SpawnOpts,
} from "../../src/core/agent-adapter.js";
import type { Comment, Tour } from "../../src/core/types.js";

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

function ann(over: Partial<Comment> & { id: string }): Comment {
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

describe("buildEnvelope", () => {
  it("packs the full thread chain when triggering on a reply", () => {
    const root = ann({ id: "a1" });
    const r1 = ann({
      id: "a2",
      thread_id: "a1",
      author_kind: "human",
      created_at: "2026-05-10T12:00:01Z",
    });
    const r2 = ann({
      id: "a3",
      thread_id: "a1",
      author_kind: "agent",
      created_at: "2026-05-10T12:00:02Z",
    });
    const env = buildEnvelope(tour(), [root, r1, r2], r1);
    expect(env.tour.id).toBe("2026-05-10-120000-test");
    expect(env.triggering_comment.id).toBe("a2");
    expect(env.thread.map((a) => a.id)).toEqual(["a1", "a2", "a3"]);
  });

  it("packs just the root when triggering on a top-level comment", () => {
    const root = ann({ id: "a1" });
    const env = buildEnvelope(tour(), [root], root);
    expect(env.thread.map((a) => a.id)).toEqual(["a1"]);
  });
});

describe("spawnReplyAgent", () => {
  it("renders the template and spawns the resolved argv", async () => {
    let received: { cmd: string; args: string[]; opts: SpawnOpts } | null = null;
    const fake = (cmd: string, args: string[], opts: SpawnOpts): SpawnedAdapter => {
      received = { cmd, args, opts };
      return {
        pid: 4242,
        onStdout: () => {},
        onStderr: () => {},
        exit: Promise.resolve({
          code: 0,
          signal: null,
          stdout: "fake reply\n",
        }),
      };
    };
    const t = tour();
    const triggering = ann({ id: "a1", author_kind: "human" });
    const envelope = buildEnvelope(t, [triggering], triggering);
    const spawned = spawnReplyAgent({
      agent: "fake-cli --system {systemPrompt} {userPrompt} {combinedPrompt}",
      envelope,
      systemPrompt: "SYS",
      cwd: "/tmp",
      tourDir: "/tmp/.tour/x",
      spawnCli: fake,
    });
    expect(spawned.pid).toBe(4242);
    const result = await spawned.exit;
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("fake reply\n");
    expect(received?.cmd).toBe("fake-cli");
    expect(received?.args[0]).toBe("--system");
    expect(received?.args[1]).toBe("SYS");
    expect(received?.args[2]).toContain("A human reviewer just left a note");
    expect(received?.args[2]).toContain(t.id);
    expect(received?.args[3]).toContain("<system>\nSYS\n</system>");
    expect(received?.opts.envelope.tour.id).toBe(t.id);
  });

  it("throws on an invalid template", () => {
    const t = tour();
    const triggering = ann({ id: "a1", author_kind: "human" });
    const envelope = buildEnvelope(t, [triggering], triggering);
    expect(() =>
      spawnReplyAgent({
        agent: "fake-cli {sytemPrompt}",
        envelope,
        systemPrompt: "SYS",
        cwd: "/tmp",
        tourDir: "/tmp/.tour/x",
      }),
    ).toThrow(/Unknown placeholder \{sytemPrompt\}/);
  });
});
