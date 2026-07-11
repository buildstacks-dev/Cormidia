// Tests the shared tool_use event builder in src/runtime/tool-events.ts
// (issue #27): the ONE environment-command classification list and the
// L2-bridgeable event shape every adapter emits through.
// Pure functions; no network, SDKs, filesystem, or clock.

import { describe, expect, it } from "vitest";
import { environmentCategory, toolUseEvent } from "../../src/runtime/tool-events.js";

const bash = (command: string) => ({ tool: "bash", input: { command } });

describe("environmentCategory", () => {
  it("tags environment-setup and wait commands", () => {
    for (const command of [
      "docker compose up -d",
      "docker-compose up",
      "docker build -t app .",
      "sudo apt-get install -y jq",
      "npm ci",
      "pnpm install",
      "brew install redis",
      "sleep 30",
      "make lint && pnpm install",
    ]) {
      expect(environmentCategory(bash(command)), command).toBe("environment_retry");
    }
  });

  it("leaves ordinary commands untagged", () => {
    for (const command of [
      "ls -la",
      "git status",
      "grep install README.md",
      "echo docker restart",
      "pnpm test",
      "cat package.json",
    ]) {
      expect(environmentCategory(bash(command)), command).toBeUndefined();
    }
  });

  it("never tags non-command tools", () => {
    expect(environmentCategory({ tool: "write", input: { path: "a.ts" } })).toBeUndefined();
    expect(environmentCategory({ tool: "bash", input: undefined })).toBeUndefined();
  });
});

describe("toolUseEvent", () => {
  it("builds the L2-bridgeable shape: name, args, detail from the command", () => {
    expect(toolUseEvent(bash("ls -la"))).toEqual({
      type: "tool_use",
      name: "bash",
      detail: "bash: ls -la",
      args: { command: "ls -la" },
    });
  });

  it("carries the environment category and reported outcome fields", () => {
    const event = toolUseEvent(bash("pnpm install"), { success: false, durationMs: 950 });
    expect(event).toMatchObject({
      name: "bash",
      category: "environment_retry",
      success: false,
      durationMs: 950,
    });
  });

  it("falls back to the tool name for non-command tools and omits unset outcome fields", () => {
    const event = toolUseEvent({ tool: "write", input: { path: "src/a.ts" } });
    expect(event.detail).toBe("write");
    expect("success" in event).toBe(false);
    expect("durationMs" in event).toBe(false);
    expect("category" in event).toBe(false);
  });
});
