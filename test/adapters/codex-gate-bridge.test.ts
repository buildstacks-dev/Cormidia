import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  codexAppServerArgs,
  codexGateHookCommand,
  normalizeCodexHookActions,
  startCodexGateBridge,
} from "../../src/runtime/adapters/codex-gate-bridge.js";
import { defaultGate } from "../../src/runtime/gate.js";
import type { GateEscalation } from "../../src/runtime/types.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("routes an auto-approved Codex Bash read through GateFn and emits a hook denial", async () => {
  const workdir = mkdtempSync(join(tmpdir(), "operon-codex-gate-"));
  roots.push(workdir);
  const escalations: GateEscalation[] = [];
  const calls: string[] = [];
  const bridge = await startCodexGateBridge(
    workdir,
    {
      gate: (action) => {
        calls.push(JSON.stringify(action));
        return defaultGate(action);
      },
    },
    escalations,
  );

  try {
    const response = await invokeHook(bridge.env, workdir, {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "cat .env" },
    });
    expect(response).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
      },
    });
    expect(calls).toEqual([JSON.stringify({ tool: "bash", input: { command: "cat .env" } })]);
    expect(escalations).toHaveLength(1);
  } finally {
    await bridge.close();
  }
});

it("allows a routine read and fails a multi-file patch closed when any file is denied", async () => {
  const workdir = mkdtempSync(join(tmpdir(), "operon-codex-gate-patch-"));
  roots.push(workdir);
  const actions: string[] = [];
  const escalations: GateEscalation[] = [];
  const bridge = await startCodexGateBridge(
    workdir,
    {
      gate: (action) => {
        const path = (action.input as { path?: string }).path;
        actions.push(path ?? String((action.input as { command?: string }).command));
        return path === "pipelines.yaml"
          ? { allow: false, reason: "protocol surface", escalate: true }
          : { allow: true };
      },
    },
    escalations,
  );
  try {
    const allowed = await invokeHook(bridge.env, workdir, {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "cat package.json" },
    });
    expect(allowed).toMatchObject({
      hookSpecificOutput: { permissionDecision: "allow" },
    });
    const denied = await invokeHook(bridge.env, workdir, {
      hook_event_name: "PreToolUse",
      tool_name: "apply_patch",
      tool_input: {
        command:
          "*** Begin Patch\n*** Update File: src/index.ts\n*** Update File: pipelines.yaml\n*** End Patch",
      },
    });
    expect(denied).toMatchObject({
      hookSpecificOutput: {
        permissionDecision: "deny",
        permissionDecisionReason: "protocol surface",
      },
    });
    expect(actions).toEqual(["cat package.json", "src/index.ts", "pipelines.yaml"]);
    expect(escalations).toHaveLength(1);
  } finally {
    await bridge.close();
  }
});

it("pins App Server to supported hookable tool paths", () => {
  const args = codexAppServerArgs("/usr/bin/true");
  expect(args).toEqual(
    expect.arrayContaining([
      "--dangerously-bypass-hook-trust",
      "bypass_hook_trust=true",
      "features.hooks=true",
      "features.unified_exec=false",
      "features.apps=false",
      "features.plugins=false",
      "features.in_app_browser=false",
      "features.plugin_sharing=false",
      "tools.web_search=false",
      'web_search="disabled"',
      "tools.view_image=false",
    ]),
  );
  expect(args.find((value) => value.startsWith("hooks.PreToolUse="))).toContain(
    "hooks.PreToolUse=",
  );
  expect(args.slice(-2)).toEqual(["--listen", "stdio://"]);
  expect(codexGateHookCommand()).toContain("codex-gate-hook.ts");
});

it("normalizes every file in a Codex apply_patch hook", () => {
  expect(
    normalizeCodexHookActions(
      {
        tool_name: "apply_patch",
        tool_input: {
          command:
            "*** Begin Patch\n*** Add File: src/new.ts\n*** Delete File: src/old.ts\n*** End Patch",
        },
      },
      "/work",
    ),
  ).toEqual([
    { tool: "write", input: { path: "src/new.ts" } },
    { tool: "edit", input: { path: "src/old.ts" } },
  ]);
});

function invokeHook(
  env: NodeJS.ProcessEnv,
  cwd: string,
  input: unknown,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/sh", ["-c", codexGateHookCommand()], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`hook exited ${String(code)}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as Record<string, unknown>);
      } catch (error) {
        reject(new Error(`invalid hook output: ${stdout}: ${String(error)}`));
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
