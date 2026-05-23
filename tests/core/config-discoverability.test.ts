import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  editorNotConfiguredMessage,
  requestReplyConfigHint,
  shouldShowRequestReplyConfigHint,
} from "../../src/core/config-discoverability.js";
import { tourHome } from "../../src/core/tour-home.js";

describe("Tour config discoverability nudges", () => {
  it("renders path-aware editor and reply-agent hints", () => {
    const configPath = "/tmp/tour-home/config.toml";

    expect(editorNotConfiguredMessage(configPath)).toBe(
      "o: editor not configured — set $TOUR_EDITOR, add `editor` to /tmp/tour-home/config.toml, or pass --editor",
    );
    expect(requestReplyConfigHint(configPath)).toBe(
      "Set `reply_agent` in /tmp/tour-home/config.toml to enable Request reply",
    );
  });

  it("shows the reply-agent hint only for human unreplied cards with no reply-agent", () => {
    expect(
      shouldShowRequestReplyConfigHint({
        replyAgentConfigured: false,
        authorKind: "human",
        hasReply: false,
      }),
    ).toBe(true);
    expect(
      shouldShowRequestReplyConfigHint({
        replyAgentConfigured: true,
        authorKind: "human",
        hasReply: false,
      }),
    ).toBe(false);
    expect(
      shouldShowRequestReplyConfigHint({
        replyAgentConfigured: false,
        authorKind: "agent",
        hasReply: false,
      }),
    ).toBe(false);
    expect(
      shouldShowRequestReplyConfigHint({
        replyAgentConfigured: false,
        authorKind: "human",
        hasReply: true,
      }),
    ).toBe(false);
  });

  it("renders default and custom Tour config paths from the live tour home", () => {
    const defaultConfigPath = join(tourHome({}), "config.toml");
    const customConfigPath = join(tourHome({ TOUR_HOME: "/tmp/custom-tour" }), "config.toml");

    expect(requestReplyConfigHint(defaultConfigPath)).toContain(defaultConfigPath);
    expect(editorNotConfiguredMessage(customConfigPath)).toContain(customConfigPath);
  });
});
