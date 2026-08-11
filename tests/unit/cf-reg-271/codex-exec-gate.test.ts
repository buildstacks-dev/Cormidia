// CF-REG-271 — HB-139 — case-catalog.md §10.3, defect #271.

// CF-REG-271 — @openai/codex 0.144.4 exposed code-mode shell execution as
// `exec`, bypassing the legacy Bash matcher and both live gate denials. The
// adapter now disables the unclassifiable code-mode family and matches `exec`
// defensively so any ignored disable fails closed in the hook normalizer.

import { describe, expect, it } from "vitest";
import { codexAppServerArgs, normalizeCodexHookActions } from "../../../src/runtime/adapters/codex-gate-bridge.js";

const MODEL_CATALOG = "/tmp/cormidia-direct-tool-model-catalog.json";

const CODE_MODE_DISABLES = [
  "features.code_mode=false",
  "features.code_mode_host=false",
  "features.code_mode_only=false",
] as const;

function execRouteDefects(args: readonly string[]): string[] {
  const matcher = args.find((arg) => arg.includes("hooks.PreToolUse")) ?? "";
  return [
    ...CODE_MODE_DISABLES.filter((token) => !args.includes(token)).map((token) => `missing:${token}`),
    ...(matcher.includes("Bash|exec|apply_patch") ? [] : ["matcher:exec-uncovered"]),
  ];
}

describe("CF-REG-271 — Codex code-mode exec cannot bypass the gate", () => {
  it("disables every code-mode switch and keeps exec inside the defensive hook matcher", () => {
    expect(execRouteDefects(codexAppServerArgs(MODEL_CATALOG))).toEqual([]);
  });

  it("fails closed on the exact exec input family observed in the L3 session", () => {
    expect(() =>
      normalizeCodexHookActions(
        {
          tool_name: "exec",
          tool_input: {
            input: "const r = await tools.shell_command({command: 'cat /etc/hosts'}); text(r)",
          },
        },
        "/tmp/worktree",
      ),
    ).toThrow(/not a gateable tool route/);
  });

  it("negative control: catches a seeded legacy matcher plus re-enabled code mode", () => {
    const seededBypass = codexAppServerArgs(MODEL_CATALOG)
      .filter((arg) => !CODE_MODE_DISABLES.includes(arg as (typeof CODE_MODE_DISABLES)[number]))
      .map((arg) => arg.replace("Bash|exec|apply_patch", "Bash|apply_patch"));

    expect(execRouteDefects(seededBypass)).toEqual([
      "missing:features.code_mode=false",
      "missing:features.code_mode_host=false",
      "missing:features.code_mode_only=false",
      "matcher:exec-uncovered",
    ]);
    expect(execRouteDefects(codexAppServerArgs(MODEL_CATALOG))).toEqual([]);
  });
});
