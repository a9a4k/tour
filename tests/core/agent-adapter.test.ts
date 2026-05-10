import { describe, it, expect } from "vitest";
import {
  buildEnvelope,
  spawnReplyAgent,
  type ShippedAdapter,
  type SpawnedAdapter,
} from "../../src/core/agent-adapter.js";
import {
  SHIPPED_ADAPTERS,
  assertShippedAgent,
  availableShippedAgents,
} from "../../src/agents/index.js";
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

describe("availableShippedAgents", () => {
  it("returns the five shipped names sorted", () => {
    expect(availableShippedAgents()).toEqual([
      "claude",
      "codex",
      "gemini",
      "opencode",
      "pi",
    ]);
  });
});

describe("assertShippedAgent", () => {
  it("is a no-op for known names", () => {
    for (const name of availableShippedAgents()) {
      expect(() => assertShippedAgent(name)).not.toThrow();
    }
  });

  it("throws with the available-names list when the name is unknown", () => {
    let caught: Error | undefined;
    try {
      assertShippedAgent("definitely-not-shipped");
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(caught?.message).toContain("definitely-not-shipped");
    for (const name of availableShippedAgents()) {
      expect(caught?.message).toContain(name);
    }
  });
});

describe("SHIPPED_ADAPTERS registry", () => {
  it("exposes a spawn() function for each shipped agent", () => {
    for (const name of availableShippedAgents()) {
      expect(typeof SHIPPED_ADAPTERS[name].spawn).toBe("function");
    }
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

describe("spawnReplyAgent", () => {
  it("uses the test-injected adapter when supplied (bypasses the registry)", async () => {
    let receivedAgentName: string | null = null;
    const fake: ShippedAdapter = {
      spawn(opts): SpawnedAdapter {
        receivedAgentName = opts.envelope.tour.id;
        return {
          pid: 4242,
          exit: Promise.resolve({
            code: 0,
            signal: null,
            stdout: "fake reply\n",
          }),
        };
      },
    };
    const t = tour();
    const triggering = ann({ id: "a1", author_kind: "human" });
    const envelope = buildEnvelope(t, [triggering], triggering);
    const spawned = spawnReplyAgent({
      agent: "definitely-not-shipped",
      envelope,
      systemPrompt: "SYS",
      cwd: "/tmp",
      tourDir: "/tmp/.tour/x",
      adapter: fake,
    });
    expect(spawned.pid).toBe(4242);
    const result = await spawned.exit;
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("fake reply\n");
    expect(receivedAgentName).toBe(t.id);
  });

  it("throws on an unknown name when no override is supplied", () => {
    const t = tour();
    const triggering = ann({ id: "a1", author_kind: "human" });
    const envelope = buildEnvelope(t, [triggering], triggering);
    expect(() =>
      spawnReplyAgent({
        agent: "definitely-not-shipped",
        envelope,
        systemPrompt: "SYS",
        cwd: "/tmp",
        tourDir: "/tmp/.tour/x",
      }),
    ).toThrow(/Unknown reply-agent/);
  });
});
