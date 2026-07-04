// Gate conformance seed. Today this tests the default gate directly; the same
// cases become the adapter conformance suite — every Runtime must demonstrate
// that these actions, attempted mid-turn (including by subagents), are
// blocked and escalated.

import { describe, expect, it } from "vitest";
import { classify, defaultGate } from "../src/runtime/gate.js";
import type { ToolAction } from "../src/runtime/types.js";

const bash = (command: string): ToolAction => ({ tool: "bash", input: { command } });

const CRITICAL_CASES: { action: ToolAction; rule: string }[] = [
  { action: bash("doctl apps create-deployment 1a2b"), rule: "production-deploy" },
  { action: bash("kubectl apply -f prod.yaml"), rule: "production-deploy" },
  { action: bash("rm -rf /workspace/data"), rule: "destructive-or-irreversible" },
  { action: bash("git push --force-push origin main"), rule: "destructive-or-irreversible" },
  { action: bash("npm publish --access public"), rule: "external-publishing" },
  { action: bash("cat .env"), rule: "secrets-or-auth" },
  {
    action: { tool: "edit", input: { path: "TASTE.md", old: "a", new: "b" } },
    rule: "protocol-self-edit",
  },
  {
    action: { tool: "write", input: { path: "roles.yaml", content: "..." } },
    rule: "protocol-self-edit",
  },
];

const ROUTINE_CASES: ToolAction[] = [
  bash("pnpm test"),
  bash("git commit -m 'feat: add parser'"),
  bash("git push origin feature/parser"),
  { tool: "read", input: { path: "src/cli.ts" } },
  { tool: "edit", input: { path: "src/org/roles.ts", old: "a", new: "b" } },
  { tool: "read", input: { path: "TASTE.md" } }, // READING protocol docs is fine
];

describe("critical-ops gate (default policy)", () => {
  for (const { action, rule } of CRITICAL_CASES) {
    it(`denies + escalates: ${rule} — ${JSON.stringify(action.input).slice(0, 60)}`, () => {
      expect(classify(action)).toEqual({ cls: "critical", rule });
      const decision = defaultGate(action);
      expect(decision.allow).toBe(false);
      if (!decision.allow) expect(decision.escalate).toBe(true);
    });
  }

  for (const action of ROUTINE_CASES) {
    it(`allows routine: ${JSON.stringify(action.input).slice(0, 60)}`, () => {
      expect(classify(action).cls).toBe("routine");
      expect(defaultGate(action)).toEqual({ allow: true });
    });
  }
});
