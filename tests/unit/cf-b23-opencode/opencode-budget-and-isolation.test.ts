// CF-B23-BUDGET / CF-B23-HERMETIC / CF-B23-SHAPE: the OpenCode adapter's
// running budget guard, ambient-context isolation, and role shaping.
//
// The budget guard is pinned OFFLINE and never live (docs/harness/adding-updating.md
// §5): a live overrun proves one run, a scripted checkpoint sequence proves the
// rule. Isolation is pinned here as the env contract; the certification lane
// proves the same env actually keeps an operator sentinel out of a real turn.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeOpencodeToolActions, OPENCODE_TOOLS } from "../../../src/runtime/adapters/opencode-gate-bridge.js";
import { buildOpencodeInlineConfig, opencodePermissionConfig } from "../../../src/runtime/adapters/opencode-config.js";
import { opencodeHermeticEnv } from "../../../src/runtime/adapters/opencode-server.js";
import { runtimeCapabilityProfile } from "../../../src/runtime/capabilities.js";
import { HARNESS_SUPPORT, bandForVersion } from "../../../src/runtime/harness-support.js";
import { readBinaryVersion } from "../../../src/runtime/harness-version-detect.js";
import { configuredProviderFamily } from "../../../src/runtime/assignment.js";
import { costEnforcementFor } from "../../../src/runtime/turn-budget.js";
import { RUNTIME_KINDS, getRuntime } from "../../../src/runtime/registry.js";
import { opencodeDouble, opencodeDoubleRequest } from "../../fixtures/adapters/opencode-double.js";
import { script } from "../../fixtures/adapters/scenario.js";
import { makeTempGitRepo, type TempGitRepo } from "../../fixtures/git-repo.js";

let repo: TempGitRepo | undefined;
afterEach(async () => {
  await repo?.cleanup();
  repo = undefined;
});

const allowAll = { gate: () => ({ allow: true }) as const };

describe("CF-B23-BUDGET — the per-turn cap is a running guard, not a post-mortem", () => {
  it("stops mid-turn at the cap, fails with error_max_budget_usd, and emits exactly one incident note", async () => {
    repo = await makeTempGitRepo();
    const dbl = opencodeDouble([
      script.turn({
        sessionId: "ses_budget",
        steps: [
          script.usageUpdate({ inputTokens: 1_000, outputTokens: 100 }),
          script.tool("bash", { command: "echo still-running" }),
        ],
        outcome: script.success("should never be reached", {
          usage: { inputTokens: 90_000, outputTokens: 9_000 },
          costUsd: 9.9,
        }),
      }),
    ]);
    // The scripted checkpoint carries the crossing cost, so the guard must fire
    // BEFORE the remaining steps play.
    const result = await dbl.runtime.runTurn(
      opencodeDoubleRequest({
        workdir: repo.dir,
        role: {
          name: "planner",
          runtime: "opencode",
          model: "scripted/opencode-scripted-model",
          effort: "high",
          delegation: { allow: [] },
          triggers: [],
          outputs: [],
          maxTurnBudgetUsd: 0.0000001,
        },
      }),
      allowAll,
    );
    expect(result).toMatchObject({ status: "failed", errorCode: "error_max_budget_usd" });
    expect(result.artifacts.filter((artifact) => artifact.ref.startsWith("budget-overrun/"))).toHaveLength(1);
    expect(result.artifacts[0]!.summary).toContain("Overrun = incident note, not silent spend");
    // Spend still settles: the overshoot is retained, never dropped.
    expect(result.usage.tokensIn).toBeGreaterThan(0);
    expect(result.usage.quality).toBe("partial");
    expect(dbl.recorder.turns[0]!.aborted).toBe(true);
  });

  it("a turn inside the cap never claims an overrun", async () => {
    repo = await makeTempGitRepo();
    const dbl = opencodeDouble([
      script.turn({
        sessionId: "ses_within",
        outcome: script.success("done", { usage: { inputTokens: 100, outputTokens: 10 }, costUsd: 0.01 }),
      }),
    ]);
    const result = await dbl.runtime.runTurn(opencodeDoubleRequest({ workdir: repo.dir }), allowAll);
    expect(result.status).toBe("completed");
    expect(result.errorCode).toBeUndefined();
    expect(result.artifacts).toEqual([]);
  });

  it("cancellation stops the provider session and preserves the usage already observed", async () => {
    repo = await makeTempGitRepo();
    const controller = new AbortController();
    const dbl = opencodeDouble([
      script.turn({
        sessionId: "ses_cancel",
        steps: [
          script.usageUpdate({ inputTokens: 700, outputTokens: 30 }),
          script.tool("bash", { command: "echo after-cancel" }),
        ],
        outcome: script.success("should never be reached", {
          usage: { inputTokens: 5_000, outputTokens: 500 },
          costUsd: 0.5,
        }),
      }),
    ]);
    const request = opencodeDoubleRequest({ workdir: repo.dir, signal: controller.signal });
    const running = dbl.runtime.runTurn(request, {
      gate: () => ({ allow: true }),
      onProgress: (progress) => {
        if ((progress.usage?.tokensIn ?? 0) > 0) controller.abort("operator cancellation");
      },
    });
    const result = await running;
    expect(result).toMatchObject({ status: "cancelled", errorCode: "error_cancelled" });
    expect(result.summary).toBe("operator cancellation");
    expect(result.usage.tokensIn).toBe(700);
    expect(result.usage.tokensOut).toBe(30);
    expect(result.usage.quality).toBe("partial");
    expect(dbl.recorder.turns[0]!.aborted).toBe(true);
  });
});

describe("CF-B23-HERMETIC — ambient operator context is closed at the process boundary", () => {
  it("redirects the config root and disables every ambient rules channel, but keeps the auth store", () => {
    const env = opencodeHermeticEnv("/tmp/cormidia-cfg", { HOME: "/Users/operator", PATH: "/usr/bin" });
    expect(env["XDG_CONFIG_HOME"]).toBe("/tmp/cormidia-cfg");
    expect(env["OPENCODE_DISABLE_CLAUDE_CODE"]).toBe("1");
    expect(env["OPENCODE_DISABLE_EXTERNAL_SKILLS"]).toBe("1");
    expect(env["OPENCODE_DISABLE_AUTOUPDATE"]).toBe("1");
    expect(env["OPENCODE_DISABLE_SHARE"]).toBe("1");
    // Readiness means usable auth, and OpenCode's auth store lives under the
    // DATA home. Moving it would make every turn unauthenticated.
    expect(env["XDG_DATA_HOME"]).toBeUndefined();
    expect(env["HOME"]).toBe("/Users/operator");
  });

  it("the inline config never shares, never loads MCP servers, and carries the gate plugin", () => {
    const config = buildOpencodeInlineConfig({
      roleName: "planner",
      networkAccess: false,
      pluginUrl: "file:///tmp/plugin.js",
      instructionFiles: ["/work/.opencode/cormidia-context.md"],
    });
    expect(config["plugin"]).toEqual(["file:///tmp/plugin.js"]);
    expect(config["instructions"]).toEqual(["/work/.opencode/cormidia-context.md"]);
    expect(config["share"]).toBe("disabled");
    expect(config["autoupdate"]).toBe(false);
    expect(config["mcp"]).toEqual({});
  });
});

describe("CF-B23-SHAPE — deny-by-default shaping and role-forbidden acts", () => {
  it("denies unknown permission keys by default and never asks", () => {
    const permission = opencodePermissionConfig({ roleName: "planner", networkAccess: false });
    expect(permission["*"]).toBe("deny");
    expect(permission["bash"]).toBe("allow");
    expect(permission["skill"]).toBe("deny");
    expect(permission["question"]).toBe("deny");
    expect(JSON.stringify(permission)).not.toContain('"ask"');
  });

  it("opens the network surfaces only when the turn opted in", () => {
    const closed = opencodePermissionConfig({ roleName: "planner", networkAccess: false });
    const open = opencodePermissionConfig({ roleName: "planner", networkAccess: true });
    expect(closed["webfetch"]).toBe("deny");
    expect(closed["websearch"]).toBe("deny");
    expect(open["webfetch"]).toBe("allow");
    expect(open["websearch"]).toBe("allow");
  });

  it("makes a builder's forbidden acts unrepresentable at the provider's own layer", () => {
    const builder = opencodePermissionConfig({ roleName: "builder", networkAccess: false });
    expect(builder["bash"]).toMatchObject({ "*": "allow", "gh pr merge*": "deny", "kubectl*": "deny" });
    expect(builder["edit"]).toMatchObject({ "~/.claude/**": "deny", "~/.config/opencode/**": "deny" });
    expect(builder["write"]).toMatchObject({ "~/.codex/**": "deny" });
    // A role with no forbidden acts is never narrowed by shaping.
    expect(opencodePermissionConfig({ roleName: "planner", networkAccess: false })["edit"]).toBe("allow");
  });
});

describe("CF-B23-REGISTER — the harness is registered everywhere the compiler cannot check", () => {
  it("is constructible from the registry and listed in RUNTIME_KINDS", () => {
    expect(RUNTIME_KINDS).toContain("opencode");
    expect(getRuntime("opencode").kind).toBe("opencode");
  });

  it("publishes a capability profile whose tool gate is honestly adapter-built", () => {
    const profile = runtimeCapabilityProfile("opencode");
    expect(profile.ref).toBe("opencode/v1");
    expect(profile.capabilities.tool_gate).toBe("adapter");
    expect(profile.capabilities.intra_turn_fanout).toBe("native");
    expect(profile.cache.fields).toEqual(["tokensInUncached", "cacheCreationTokens", "cacheReadTokens"]);
  });

  it("normalizes OpenCode's own argument vocabulary onto the shared gate shape", () => {
    expect(normalizeOpencodeToolActions("read", { filePath: "/work/a.txt" }, "/work")).toEqual([
      { tool: "read", input: { path: "a.txt" } },
    ]);
    expect(
      normalizeOpencodeToolActions("edit", { filePath: "/work/a.txt", oldString: "x", newString: "y" }, "/work"),
    ).toEqual([{ tool: "edit", input: { path: "a.txt", old_string: "x", new_string: "y" } }]);
    expect(
      normalizeOpencodeToolActions(
        "apply_patch",
        { patchText: "*** Add File: new.txt\n+a\n*** Update File: old.txt\n" },
        "/work",
      ),
    ).toEqual([
      { tool: "write", input: { path: "new.txt" } },
      { tool: "edit", input: { path: "old.txt" } },
    ]);
    // An unknown/future tool id still reaches the gate rather than slipping past.
    expect(normalizeOpencodeToolActions("brand_new_tool", { anything: 1 }, "/work")).toEqual([
      { tool: "brand_new_tool", input: { anything: 1 } },
    ]);
  });

  it("documents the exact 1.18.15 tool roster the gate must cover", () => {
    // Read from the running server's /experimental/tool roster on 2026-08-07.
    expect([...OPENCODE_TOOLS]).toEqual([
      "apply_patch",
      "bash",
      "edit",
      "glob",
      "grep",
      "invalid",
      "question",
      "read",
      "skill",
      "task",
      "todowrite",
      "webfetch",
      "websearch",
      "write",
    ]);
  });
});

describe("CF-B23 version bands — opencode's version is read from a banner, never guessed", () => {
  it("finds the version on a later line when a banner precedes it", () => {
    // opencode's readiness probe reads the LAST line for this reason; banding
    // scans lines in order and only accepts an already-version-shaped token.
    const detection = readBinaryVersion(fakeVersionCommand("opencode\n1.18.15"), []);
    expect(detection).toEqual({ detected: true, version: "1.18.15" });
    expect(bandForVersion(HARNESS_SUPPORT.opencode, "1.18.15")).toBe("at_tested");
  });

  it("accepts a leading `v` the way the certification record writes it", () => {
    expect(readBinaryVersion(fakeVersionCommand("v1.18.15"), [])).toEqual({ detected: true, version: "1.18.15" });
  });

  it("negative control: banner-only output is never guessed into a version", () => {
    const detection = readBinaryVersion(fakeVersionCommand("opencode\nthe AI coding agent"), []);
    expect(detection).toEqual({ detected: true, version: "opencode" });
    expect(bandForVersion(HARNESS_SUPPORT.opencode, "opencode")).toBe("unknown");
  });

  it("declares opencode's bands against the certification record", () => {
    // floor === testedWith: certification proved the gate PLUGIN wires its
    // hooks on this build, and a plugin whose factory runs is not a plugin
    // whose hooks are wired.
    expect(HARNESS_SUPPORT.opencode.floor).toBe("1.18.15");
    expect(HARNESS_SUPPORT.opencode.testedWith).toBe("1.18.15");
    expect(HARNESS_SUPPORT.opencode.testedEvidence).toBe("research/2026-08-07_opencode-adapter-certification.md");
    expect(HARNESS_SUPPORT.opencode.versionSource).toEqual({
      kind: "installed_binary",
      command: "opencode",
      args: ["--version"],
    });
  });
});

describe("CF-B23 registration — opencode never inherits another harness's answer", () => {
  it("reports the routed provider family, and namespaces an unknown one to opencode", () => {
    // opencode reaches the real vendor with the OPERATOR'S OWN credential, so a
    // recognized namespace is the honest family. An unrecognized one must not
    // borrow pi's namespace or two harnesses' unknown models would collide.
    expect(configuredProviderFamily({ harness: "opencode", model: "openai/gpt-5.6", effort: "medium" })).toBe("openai");
    expect(configuredProviderFamily({ harness: "opencode", model: "anthropic/claude-opus-5", effort: "medium" })).toBe(
      "anthropic",
    );
    expect(configuredProviderFamily({ harness: "opencode", model: "scripted/x", effort: "medium" })).toBe(
      "opencode/scripted",
    );
    // A namespace that is not even a well-formed id still stays opencode's.
    expect(configuredProviderFamily({ harness: "opencode", model: "Not An Id/x", effort: "medium" })).toBe(
      "opencode/unknown",
    );
  });

  it("reports an estimated running guard, not pi's measured one", () => {
    // Dollars come from the models.dev catalog, not a billing response.
    expect(costEnforcementFor("opencode")).toBe("estimated_progress_no_strict_provider_cap");
  });
});

const versionCommandDir = mkdtempSync(join(tmpdir(), "cormidia-opencode-version-"));
let versionCommandSeq = 0;

/** A tiny executable printing `text`, so the real `execFileSync` path runs. */
function fakeVersionCommand(text: string): string {
  const script = join(versionCommandDir, `v${(versionCommandSeq += 1)}.sh`);
  writeFileSync(script, `#!/bin/sh\nprintf '%b\\n' ${JSON.stringify(text)}\n`, { mode: 0o755 });
  return script;
}
